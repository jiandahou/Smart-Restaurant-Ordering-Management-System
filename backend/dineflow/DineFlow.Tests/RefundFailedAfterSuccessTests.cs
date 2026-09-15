using System.Text.Json;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A refund that succeeds and then fails.
/// </summary>
/// <remarks>
/// <para>
/// Stripe reports a refund as succeeded once it has sent the money on. The customer's bank can still
/// reject it days later, and Stripe then raises <c>refund.failed</c> and returns the funds to the
/// platform balance. DineFlow dropped that event: the refund stayed Succeeded, the payment stayed
/// Refunded, the failure reason stayed empty, and the refundable balance stayed spent. The record
/// said the customer had been refunded when they had not, and nobody could try again — the one state
/// in this system that is only ever true because the provider says so, held against the provider.
/// </para>
/// <para>
/// The event is replayed at the real webhook endpoint, signed the way Stripe signs it, so the
/// signature check and the handler's transaction run as they do in production.
/// </para>
/// </remarks>
public sealed class RefundFailedAfterSuccessTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private Guid _orderId;
    private Guid _paymentId;
    private Guid _refundId;

    private const string PaymentIntentId = "pi_refund_failed_test";
    private const string StripeRefundId = "re_refund_failed_test";
    private const long AmountCents = 2_600;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(FrontCounterScenario.Restaurant(_restaurantId, "Refund Kitchen"));

            var order = new Order
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                OrderNumber = "REFUND-1",
                Status = OrderStatus.Completed,
                // Where the money ended up as far as DineFlow was concerned: fully refunded.
                PaymentStatus = PaymentStatus.Refunded,
                PaymentMethod = PaymentMethod.Online,
                TotalAmount = 26m
            };
            _orderId = order.Id;

            var payment = new Payment
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                Provider = PaymentProviders.Stripe,
                ProviderPaymentIntentId = PaymentIntentId,
                Status = PaymentStatus.Refunded,
                AmountCents = AmountCents,
                Currency = "aud",
                CreatedAt = DateTime.UtcNow.AddHours(-3)
            };
            _paymentId = payment.Id;

            var refund = new PaymentRefund
            {
                Id = Guid.NewGuid(),
                PaymentId = payment.Id,
                OrderId = order.Id,
                Provider = PaymentProviders.Stripe,
                ProviderRefundId = StripeRefundId,
                ProviderPaymentIntentId = PaymentIntentId,
                Status = PaymentRefundStatus.Succeeded,
                AmountCents = AmountCents,
                Currency = "aud",
                RefundedAt = DateTime.UtcNow.AddHours(-2),
                CreatedAt = DateTime.UtcNow.AddHours(-2),
                LastProviderEventCreatedAt = DateTime.UtcNow.AddHours(-2)
            };
            _refundId = refund.Id;

            context.Orders.Add(order);
            context.Payments.Add(payment);
            context.PaymentRefunds.Add(refund);
            await context.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private static string RefundEvent(string type, string status, string? failureReason, DateTimeOffset created)
    {
        var payload = new
        {
            id = $"evt_{Guid.NewGuid():N}",
            type,
            // Every real Stripe event carries one, and the library dereferences it while checking
            // compatibility. Without it the parse throws before the handler is ever reached.
            api_version = Stripe.StripeConfiguration.ApiVersion,
            created = created.ToUnixTimeSeconds(),
            data = new
            {
                @object = new
                {
                    id = StripeRefundId,
                    @object = "refund",
                    amount = AmountCents,
                    currency = "aud",
                    payment_intent = PaymentIntentId,
                    metadata = new Dictionary<string, string>(),
                    status,
                    failure_reason = failureReason,
                    created = created.ToUnixTimeSeconds()
                }
            }
        };

        return JsonSerializer.Serialize(payload);
    }

    private async Task<System.Net.HttpStatusCode> ReplayAsync(
        string type, string status, string? failureReason, DateTimeOffset created)
    {
        var client = _api.CreateClient();
        var request = StripeWebhookRequest.Create(
            RefundEvent(type, status, failureReason, created),
            DineFlowApiFactory.StripeWebhookSecret);

        var response = await client.SendAsync(request);

        // A webhook that throws is answered with a 500, and Stripe retries it for days without ever
        // getting anywhere — so the body is worth reading out loud when it happens.
        Assert.True(
            (int)response.StatusCode < 500,
            $"Webhook returned {response.StatusCode}: {await response.Content.ReadAsStringAsync()}");

        return response.StatusCode;
    }

    /// <summary>The refund itself stops claiming the money went back, and says why.</summary>
    [RequiresPostgresFact]
    public async Task LetsAFailureAfterTheFactOverturnASucceededRefund()
    {
        var status = await ReplayAsync(
            "refund.failed", "failed", "The bank rejected the refund.", DateTimeOffset.UtcNow);

        Assert.Equal(System.Net.HttpStatusCode.OK, status);
        await _api.UseDbAsync(async context =>
        {
            var refund = await context.PaymentRefunds.AsNoTracking().SingleAsync(item => item.Id == _refundId);

            Assert.Equal(PaymentRefundStatus.Failed, refund.Status);
            Assert.NotNull(refund.FailedAt);
            Assert.Equal("The bank rejected the refund.", refund.FailureReason);
        });
    }

    /// <summary>
    /// And the money is refundable again, which is the whole point: someone has to be able to try
    /// once more for a customer who never got their money.
    /// </summary>
    [RequiresPostgresFact]
    public async Task GivesTheRefundableBalanceBack()
    {
        await ReplayAsync("refund.failed", "failed", "The bank rejected the refund.", DateTimeOffset.UtcNow);

        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);
            var order = await context.Orders.AsNoTracking().SingleAsync(item => item.Id == _orderId);

            Assert.Equal(PaymentStatus.Paid, payment.Status);
            Assert.Equal(PaymentStatus.Paid, order.PaymentStatus);

            var stillRefunded = await context.PaymentRefunds
                .Where(refund => refund.PaymentId == _paymentId && refund.Status == PaymentRefundStatus.Succeeded)
                .SumAsync(refund => (long?)refund.AmountCents) ?? 0;
            Assert.Equal(0, stillRefunded);
        });
    }

    /// <summary>
    /// A retry that works settles it. The pair together is the recovery the counter needs: overturn,
    /// then refund again.
    /// </summary>
    [RequiresPostgresFact]
    public async Task LetsASecondAttemptSucceedAfterwards()
    {
        await ReplayAsync("refund.failed", "failed", "The bank rejected the refund.", DateTimeOffset.UtcNow.AddMinutes(-2));

        await ReplayAsync("refund.updated", "succeeded", null, DateTimeOffset.UtcNow);

        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);
            Assert.Equal(PaymentStatus.Refunded, payment.Status);
        });
    }

    /// <summary>
    /// Ordering is still respected: an event older than what has already been applied changes
    /// nothing, so a late failure cannot undo a refund that has since gone through.
    /// </summary>
    [RequiresPostgresFact]
    public async Task IgnoresAFailureThatIsOlderThanWhatWasAlreadyApplied()
    {
        var status = await ReplayAsync(
            "refund.failed", "failed", "Stale event", DateTimeOffset.UtcNow.AddHours(-6));

        Assert.Equal(System.Net.HttpStatusCode.OK, status);
        await _api.UseDbAsync(async context =>
        {
            var refund = await context.PaymentRefunds.AsNoTracking().SingleAsync(item => item.Id == _refundId);
            Assert.Equal(PaymentRefundStatus.Succeeded, refund.Status);
        });
    }

    /// <summary>A late refund.created must still not walk a succeeded refund back to pending.</summary>
    [RequiresPostgresFact]
    public async Task StillRefusesToWalkASucceededRefundBackToPending()
    {
        await ReplayAsync("refund.created", "pending", null, DateTimeOffset.UtcNow);

        await _api.UseDbAsync(async context =>
        {
            var refund = await context.PaymentRefunds.AsNoTracking().SingleAsync(item => item.Id == _refundId);
            Assert.Equal(PaymentRefundStatus.Succeeded, refund.Status);
        });
    }

    /// <summary>Replaying the same failure changes nothing the second time.</summary>
    [RequiresPostgresFact]
    public async Task SurvivesTheSameFailureBeingReplayed()
    {
        var at = DateTimeOffset.UtcNow;
        await ReplayAsync("refund.failed", "failed", "The bank rejected the refund.", at);
        await ReplayAsync("refund.failed", "failed", "The bank rejected the refund.", at);

        await _api.UseDbAsync(async context =>
        {
            Assert.Equal(1, await context.PaymentRefunds.CountAsync(refund => refund.PaymentId == _paymentId));
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);
            Assert.Equal(PaymentStatus.Paid, payment.Status);
        });
    }
}

/// <summary>
/// The two rules the webhook path turns on, checked directly.
/// </summary>
public sealed class RefundStateRuleTests
{
    /// <summary>The provider is the authority on whether money moved, in both directions.</summary>
    [Fact]
    public void ASucceededRefundCanStillBeOverturnedByAFailure()
    {
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Succeeded, PaymentRefundStatus.Failed));
    }

    [Fact]
    public void ASucceededRefundNeverSlidesBackToPending()
    {
        Assert.False(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Succeeded, PaymentRefundStatus.Pending));
        Assert.False(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Failed, PaymentRefundStatus.Pending));
    }

    /// <summary>A failed refund that later succeeds is authoritative — timeouts look like failures.</summary>
    [Fact]
    public void AFailedRefundCanStillSucceed()
    {
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Failed, PaymentRefundStatus.Succeeded));
    }

    [Fact]
    public void FullyRefundedMoneyMakesAPaymentRefunded()
    {
        Assert.Equal(
            PaymentStatus.Refunded,
            RefundAggregateStatus.Resolve(PaymentStatus.Paid, 2_600, 2_600));
    }

    [Fact]
    public void SomeRefundedMoneyMakesAPaymentPartlyRefunded()
    {
        Assert.Equal(
            PaymentStatus.PartiallyRefunded,
            RefundAggregateStatus.Resolve(PaymentStatus.Paid, 2_600, 100));
    }

    /// <summary>
    /// The case that was wrong: every refund failed, so nothing was refunded, so the payment stands
    /// and all of it is refundable again.
    /// </summary>
    [Fact]
    public void NoRefundedMoneyPutsAPaymentBackToPaid()
    {
        Assert.Equal(
            PaymentStatus.Paid,
            RefundAggregateStatus.Resolve(PaymentStatus.Refunded, 2_600, 0));
        Assert.Equal(
            PaymentStatus.Paid,
            RefundAggregateStatus.Resolve(PaymentStatus.PartiallyRefunded, 2_600, 0));
    }

    /// <summary>A payment that was never refunded is left exactly as it was found.</summary>
    [Fact]
    public void LeavesAPaymentWithNoRefundsAlone()
    {
        Assert.Equal(PaymentStatus.Paid, RefundAggregateStatus.Resolve(PaymentStatus.Paid, 2_600, 0));
        Assert.Equal(PaymentStatus.Failed, RefundAggregateStatus.Resolve(PaymentStatus.Failed, 2_600, 0));
    }
}
