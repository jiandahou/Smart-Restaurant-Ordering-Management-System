using System.Net;
using System.Text.Json;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A Stripe event that arrives before the thing it is about exists here.
/// </summary>
/// <remarks>
/// <para>
/// The webhook records each event id before running the handler, so that a redelivery of the same
/// event is answered as a duplicate. That is right for work that was done and wrong for work that was
/// not: a <c>charge.dispute.created</c> whose payment row had not been written yet was logged,
/// answered 200, and left in the dedup table — so Stripe's retry was turned away as "already seen"
/// and the dispute was never recorded at all.
/// </para>
/// <para>
/// A dispute carries a deadline for responding. Missing it loses the disputed amount by default, and
/// nothing anywhere in the product would have shown that a dispute had ever been raised.
/// </para>
/// </remarks>
public sealed class DisputeArrivingEarlyTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private const string PaymentIntentId = "pi_dispute_race_test";
    private const string DisputeId = "dp_dispute_race_test";
    private const long PaidCents = 2_600;
    private const long DisputedCents = 2_600;

    private static readonly DateTimeOffset EvidenceDueBy = DateTimeOffset.UtcNow.AddDays(7);

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        // Deliberately no payment: the dispute gets here first.
        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(FrontCounterScenario.Restaurant(_restaurantId, "Dispute Kitchen"));
            await context.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    /// <summary>Writes the payment the dispute refers to, as the checkout flow would have.</summary>
    private async Task<Guid> ArrangeThePaymentAsync()
    {
        var paymentId = Guid.NewGuid();

        await _api.UseDbAsync(async context =>
        {
            var order = new Order
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                OrderNumber = "DISPUTE-1",
                Status = OrderStatus.Completed,
                PaymentStatus = PaymentStatus.Paid,
                PaymentMethod = PaymentMethod.Online,
                TotalAmount = 26m
            };

            context.Orders.Add(order);
            context.Payments.Add(new Payment
            {
                Id = paymentId,
                OrderId = order.Id,
                Provider = PaymentProviders.Stripe,
                ProviderPaymentIntentId = PaymentIntentId,
                Status = PaymentStatus.Paid,
                AmountCents = PaidCents,
                Currency = "aud",
                CreatedAt = DateTime.UtcNow
            });

            await context.SaveChangesAsync();
        });

        return paymentId;
    }

    private static string DisputeEvent(string eventId, DateTimeOffset created) =>
        JsonSerializer.Serialize(new
        {
            id = eventId,
            type = "charge.dispute.created",
            api_version = Stripe.StripeConfiguration.ApiVersion,
            created = created.ToUnixTimeSeconds(),
            data = new
            {
                @object = new
                {
                    id = DisputeId,
                    @object = "dispute",
                    amount = DisputedCents,
                    currency = "aud",
                    payment_intent = PaymentIntentId,
                    reason = "fraudulent",
                    status = "needs_response",
                    metadata = new Dictionary<string, string>(),
                    evidence_details = new { due_by = EvidenceDueBy.ToUnixTimeSeconds() },
                    created = created.ToUnixTimeSeconds()
                }
            }
        });

    private async Task<HttpResponseMessage> DeliverAsync(string eventId, DateTimeOffset? created = null)
    {
        var client = _api.CreateClient();
        return await client.SendAsync(StripeWebhookRequest.Create(
            DisputeEvent(eventId, created ?? DateTimeOffset.UtcNow),
            DineFlowApiFactory.StripeWebhookSecret));
    }

    /// <summary>
    /// The event is not banked when nothing was done with it, so Stripe is asked to try again.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AsksStripeToRetryWhenThePaymentIsNotThereYet()
    {
        var response = await DeliverAsync("evt_dispute_early_1");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        await _api.UseDbAsync(async context =>
            Assert.False(
                await context.StripeWebhookEvents.AnyAsync(item => item.EventId == "evt_dispute_early_1"),
                "The event was recorded as handled even though the dispute was never applied."));
    }

    /// <summary>
    /// The retry, once the payment exists, records the dispute in full — which is what the deadline
    /// depends on.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RecordsTheDisputeWhenStripeRetriesAfterThePaymentArrives()
    {
        await DeliverAsync("evt_dispute_early_2");

        var paymentId = await ArrangeThePaymentAsync();
        var retry = await DeliverAsync("evt_dispute_early_2");

        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == paymentId);

            Assert.Equal(DisputeId, payment.DisputeId);
            Assert.Equal("fraudulent", payment.DisputeReason);
            Assert.Equal("needs_response", payment.DisputeStatus);
            Assert.Equal(DisputedCents, payment.DisputeAmountCents);
            Assert.NotNull(payment.DisputedAt);
            Assert.NotNull(payment.DisputeEvidenceDueBy);
            Assert.Equal(
                EvidenceDueBy.ToUnixTimeSeconds(),
                new DateTimeOffset(payment.DisputeEvidenceDueBy!.Value, TimeSpan.Zero).ToUnixTimeSeconds());
        });
    }

    /// <summary>
    /// Once it has been applied, a redelivery is still answered as a duplicate — asking for a retry
    /// must not have cost the endpoint its idempotency.
    /// </summary>
    [RequiresPostgresFact]
    public async Task StillTreatsARedeliveryOfAppliedWorkAsADuplicate()
    {
        await ArrangeThePaymentAsync();
        (await DeliverAsync("evt_dispute_applied")).EnsureSuccessStatusCode();

        var again = await DeliverAsync("evt_dispute_applied");

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Contains("duplicate", await again.Content.ReadAsStringAsync());
        await _api.UseDbAsync(async context =>
            Assert.Equal(1, await context.StripeWebhookEvents.CountAsync(item => item.EventId == "evt_dispute_applied")));
    }

    /// <summary>
    /// An event that will never match is eventually accepted, loudly.
    /// </summary>
    /// <remarks>
    /// Asking forever would be worse than the bug it fixes: Stripe disables an endpoint that keeps
    /// failing, and then nothing arrives at all.
    /// </remarks>
    [RequiresPostgresFact]
    public async Task StopsAskingForAnEventThatIsPastTheRetryWindow()
    {
        var response = await DeliverAsync(
            "evt_dispute_stale",
            DateTimeOffset.UtcNow - StripeWebhookRetryWindow.Duration.Add(TimeSpan.FromHours(1)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await _api.UseDbAsync(async context =>
            Assert.True(await context.StripeWebhookEvents.AnyAsync(item => item.EventId == "evt_dispute_stale")));
    }

    [Fact]
    public void KeepsAskingWhileTheRaceCouldStillResolve()
    {
        var now = new DateTime(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(StripeWebhookRetryWindow.ShouldAskStripeToRetry(now.AddSeconds(-5), now));
        Assert.True(StripeWebhookRetryWindow.ShouldAskStripeToRetry(now.AddHours(-23), now));
        Assert.False(StripeWebhookRetryWindow.ShouldAskStripeToRetry(now.AddHours(-25), now));
    }
}
