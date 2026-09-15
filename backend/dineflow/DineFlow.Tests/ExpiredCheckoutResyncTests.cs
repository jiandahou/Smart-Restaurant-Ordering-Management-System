using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// What Re-sync makes of a Checkout session that expired.
/// </summary>
/// <remarks>
/// <para>
/// Stripe cancels the payment intent behind an expired Checkout session, so a sync that went straight
/// to the intent read back "canceled" and wrote the payment down as Cancelled. On the screen that
/// reads as somebody having cancelled this payment — a decision, by a person — when what happened is
/// that a customer walked away from the card form and Stripe closed the session on a timer. Only the
/// session knows which of those it was, and staff act differently on each.
/// </para>
/// <para>
/// Stripe's answers are supplied by a stub: the difference under test exists only in what Stripe
/// returns, so there is no way to reach it without deciding those answers.
/// </para>
/// </remarks>
public sealed class ExpiredCheckoutResyncTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly StubStripeClient _stripe = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private Guid _paymentId;
    private Guid _orderId;

    private const string SessionId = "cs_test_expired_resync";
    private const string IntentId = "pi_test_expired_resync";

    public async Task InitializeAsync()
    {
        _api.Stripe = _stripe;
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(FrontCounterScenario.Restaurant(_restaurantId, "Resync Kitchen"));

            var order = new Order
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                OrderNumber = "RESYNC-1",
                Status = OrderStatus.Pending,
                PaymentStatus = PaymentStatus.Pending,
                PaymentMethod = PaymentMethod.Online,
                TotalAmount = 26m
            };
            _orderId = order.Id;

            var payment = new Payment
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                Provider = PaymentProviders.Stripe,
                ProviderCheckoutSessionId = SessionId,
                ProviderPaymentIntentId = IntentId,
                Status = PaymentStatus.Pending,
                AmountCents = 2_600,
                Currency = "aud",
                CreatedAt = DateTime.UtcNow.AddHours(-4)
            };
            _paymentId = payment.Id;

            context.Orders.Add(order);
            context.Payments.Add(payment);
            await context.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private async Task<HttpClient> SignInAsync() =>
        await _api.SignInAsAsync("resync-owner@dineflow.test", ApplicationRoles.RestaurantOwner, _restaurantId);

    /// <summary>
    /// The reported case: Stripe expired the session, and its intent reads canceled.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RecordsAnExpiredSessionAsExpiredRatherThanCancelled()
    {
        _stripe
            .Answering("checkout/sessions", new Stripe.Checkout.Session
            {
                Id = SessionId,
                Status = "expired",
                PaymentIntentId = IntentId
            })
            // Present, and deliberately not what the answer comes from — going here is the bug.
            .Answering("payment_intents", new Stripe.PaymentIntent
            {
                Id = IntentId,
                Status = "canceled"
            });

        var staff = await SignInAsync();
        var response = await staff.PostAsJsonAsync($"/api/payments/{_paymentId}/sync", new { });

        // A definite answer, so the person who pressed Re-sync is shown the corrected row rather than
        // an error over the state they just fixed.
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);
            var order = await context.Orders.AsNoTracking().SingleAsync(item => item.Id == _orderId);

            Assert.Equal(PaymentStatus.Expired, payment.Status);
            Assert.Equal(PaymentStatus.Expired, order.PaymentStatus);
        });
    }

    /// <summary>The session is what gets asked, which is the whole of the fix.</summary>
    [RequiresPostgresFact]
    public async Task AsksTheSessionBeforeTheIntent()
    {
        _stripe
            .Answering("checkout/sessions", new Stripe.Checkout.Session
            {
                Id = SessionId,
                Status = "expired",
                PaymentIntentId = IntentId
            })
            .Answering("payment_intents", new Stripe.PaymentIntent { Id = IntentId, Status = "canceled" });

        var staff = await SignInAsync();
        await staff.PostAsJsonAsync($"/api/payments/{_paymentId}/sync", new { });

        Assert.Contains(_stripe.Requested, path => path.Contains("checkout/sessions", StringComparison.Ordinal));
        Assert.DoesNotContain(_stripe.Requested, path => path.Contains("payment_intents", StringComparison.Ordinal));
    }

    /// <summary>
    /// A session that is still open falls through to the intent exactly as before, so a payment that
    /// really did go through is still picked up by a manual sync.
    /// </summary>
    [RequiresPostgresFact]
    public async Task StillReadsTheIntentWhenTheSessionIsLive()
    {
        _stripe
            .Answering("checkout/sessions", new Stripe.Checkout.Session
            {
                Id = SessionId,
                Status = "complete",
                PaymentIntentId = IntentId
            })
            .Answering("payment_intents", new Stripe.PaymentIntent
            {
                Id = IntentId,
                Status = "succeeded"
            });

        var staff = await SignInAsync();
        var response = await staff.PostAsJsonAsync($"/api/payments/{_paymentId}/sync", new { });

        response.EnsureSuccessStatusCode();
        Assert.Contains(_stripe.Requested, path => path.Contains("payment_intents", StringComparison.Ordinal));
        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);
            Assert.Equal(PaymentStatus.Paid, payment.Status);
        });
    }

    /// <summary>An expired attempt keeps its history: the session and intent ids stay on the record.</summary>
    [RequiresPostgresFact]
    public async Task KeepsTheFailedAttemptOnTheRecord()
    {
        _stripe
            .Answering("checkout/sessions", new Stripe.Checkout.Session
            {
                Id = SessionId,
                Status = "expired",
                PaymentIntentId = IntentId
            })
            .Answering("payment_intents", new Stripe.PaymentIntent { Id = IntentId, Status = "canceled" });

        var staff = await SignInAsync();
        await staff.PostAsJsonAsync($"/api/payments/{_paymentId}/sync", new { });

        await _api.UseDbAsync(async context =>
        {
            var payment = await context.Payments.AsNoTracking().SingleAsync(item => item.Id == _paymentId);

            Assert.Equal(SessionId, payment.ProviderCheckoutSessionId);
            Assert.Equal(IntentId, payment.ProviderPaymentIntentId);
            Assert.Equal(2_600, payment.AmountCents);
        });
    }
}
