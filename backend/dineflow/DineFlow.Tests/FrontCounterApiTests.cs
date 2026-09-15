using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The front counter endpoints, called over HTTP the way the till calls them.
/// </summary>
/// <remarks>
/// <para>
/// The suite covered policies and one concurrency case, and nothing at all between the route and the
/// policy: who may call these, whether one restaurant's staff can reach another's takings, what a
/// missing reason does, whether taking the same payment twice is refused. That is the money-handling
/// surface of the product, and it was reasoned about rather than tested.
/// </para>
/// <para>
/// Calling the controller's methods directly would answer none of it — authorization and model
/// validation live in the pipeline, not the method — so the API runs for real against a throwaway
/// database.
/// </para>
/// </remarks>
public sealed class FrontCounterApiTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private readonly Guid _otherRestaurantId = Guid.NewGuid();
    private Guid _readyOrderId;
    private Guid _otherRestaurantOrderId;

    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.AddRange(
                FrontCounterScenario.Restaurant(_restaurantId, "Counter Kitchen"),
                FrontCounterScenario.Restaurant(_otherRestaurantId, "Someone Else's Kitchen"));

            var ready = FrontCounterScenario.ReadyCounterOrder(_restaurantId, "API-READY");
            _readyOrderId = ready.Id;
            var theirs = FrontCounterScenario.ReadyCounterOrder(_otherRestaurantId, "API-THEIRS");
            _otherRestaurantOrderId = theirs.Id;

            context.Orders.AddRange(ready, theirs);
            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("counter-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private static object CashPayment(decimal received) => new { tender = "Cash", amountReceived = received };

    // ---- who may call these at all -------------------------------------------------------------

    [RequiresPostgresFact]
    public async Task RefusesAnyoneWhoIsNotSignedIn()
    {
        var anonymous = _api.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anonymous.GetAsync("/api/staff/front-counter/takeaway")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await anonymous.PostAsJsonAsync($"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m))).StatusCode);
    }

    /// <summary>A customer account is not a till, however valid its token.</summary>
    [RequiresPostgresFact]
    public async Task RefusesASignedInCustomer()
    {
        var customer = await _api.SignInAsAsync("counter-customer@dineflow.test", ApplicationRoles.Customer);

        var response = await customer.GetAsync("/api/staff/front-counter/takeaway");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// Naming another restaurant is not a way into its takings — the most valuable thing a
    /// multi-tenant counter can get wrong.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RefusesStaffReachingIntoAnotherRestaurant()
    {
        var listing = await _staff.GetAsync(
            $"/api/staff/front-counter/takeaway?restaurantId={_otherRestaurantId}");
        Assert.Equal(HttpStatusCode.Forbidden, listing.StatusCode);

        var payment = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_otherRestaurantOrderId}/record-payment?restaurantId={_otherRestaurantId}",
            CashPayment(10m));
        Assert.Equal(HttpStatusCode.Forbidden, payment.StatusCode);
    }

    /// <summary>Their own restaurant's list is theirs, with no id needed.</summary>
    [RequiresPostgresFact]
    public async Task LetsStaffSeeTheirOwnCounter()
    {
        var response = await _staff.GetAsync("/api/staff/front-counter/takeaway");

        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<TakeawayPayload>();
        Assert.Contains(payload!.Orders, order => order.OrderNumber == "API-READY");
        Assert.DoesNotContain(payload.Orders, order => order.OrderNumber == "API-THEIRS");
    }

    // ---- what the endpoints refuse to be told --------------------------------------------------

    [RequiresPostgresFact]
    public async Task RefusesAnOrderThatIsNotThere()
    {
        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{Guid.NewGuid()}/record-payment", CashPayment(10m));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>Cash that does not cover the bill is a mistake at the till, not a payment.</summary>
    [RequiresPostgresFact]
    public async Task RefusesCashThatDoesNotCoverTheBill()
    {
        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(4m));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWasTakenAsync();
    }

    [RequiresPostgresFact]
    public async Task RefusesATenderItDoesNotKnow()
    {
        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment",
            new { tender = "Bitcoin", amountReceived = 10m });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWasTakenAsync();
    }

    /// <summary>
    /// Voiding is unverifiable by the system, so it is only ever done with a reason on the record.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RefusesAVoidWithNoReason()
    {
        await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m));
        var paymentId = await LatestPaymentIdAsync();

        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/payments/{paymentId}/void", new { reason = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---- taking money once, and only once ------------------------------------------------------

    [RequiresPostgresFact]
    public async Task TakesTheMoneyAndSaysWhatChangeIsDue()
    {
        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(20m));

        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<RecordPaymentPayload>();
        Assert.Equal(20m, payload!.AmountReceived);
        Assert.Equal(10m, payload.ChangeDue);
        Assert.Equal("Paid", payload.Order.PaymentStatus);
    }

    /// <summary>
    /// The same payment sent twice — a double tap, a retried request — must not become two payments.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RefusesToTakeTheSamePaymentTwice()
    {
        var first = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m));
        first.EnsureSuccessStatusCode();

        var second = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        await _api.UseDbAsync(async context =>
            Assert.Equal(1_000, await FrontCounterScenario.CounterPaymentTotalAsync(context, _readyOrderId)));
    }

    /// <summary>
    /// Two tills ringing up the same order at the same moment. Only one of them took the money.
    /// </summary>
    [RequiresPostgresFact]
    public async Task TakesTheMoneyOnceWhenTwoTillsRingItUpTogether()
    {
        var second = await _api.SignInAsAsync("counter-staff-2@dineflow.test", ApplicationRoles.Staff, _restaurantId);

        var responses = await Task.WhenAll(
            _staff.PostAsJsonAsync($"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m)),
            second.PostAsJsonAsync($"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m)));

        Assert.Equal(1, responses.Count(response => response.IsSuccessStatusCode));
        await _api.UseDbAsync(async context =>
            Assert.Equal(1_000, await FrontCounterScenario.CounterPaymentTotalAsync(context, _readyOrderId)));
    }

    // ---- the payment stays reachable after the pickup is over -----------------------------------

    /// <summary>
    /// The counter payment for a finished pickup is still findable, which is what makes it possible
    /// to put right when the customer comes back.
    /// </summary>
    [RequiresPostgresFact]
    public async Task KeepsAFinishedPickupsPaymentWithinReach()
    {
        await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m));
        (await _staff.PostAsJsonAsync($"/api/staff/front-counter/orders/{_readyOrderId}/complete", new { }))
            .EnsureSuccessStatusCode();

        // Gone from the working list, as a finished order should be.
        var takeaway = await _staff.GetFromJsonAsync<TakeawayPayload>("/api/staff/front-counter/takeaway");
        Assert.DoesNotContain(takeaway!.Orders, order => order.OrderNumber == "API-READY");

        // Still reachable where it needs to be.
        var recent = await _staff.GetFromJsonAsync<TakeawayPayload>("/api/staff/front-counter/recent-payments");
        Assert.Contains(recent!.Orders, order => order.OrderNumber == "API-READY");
    }

    /// <summary>And once found, it can actually be put right.</summary>
    [RequiresPostgresFact]
    public async Task LetsAFinishedPickupsPaymentBeVoided()
    {
        await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/orders/{_readyOrderId}/record-payment", CashPayment(10m));
        (await _staff.PostAsJsonAsync($"/api/staff/front-counter/orders/{_readyOrderId}/complete", new { }))
            .EnsureSuccessStatusCode();
        var paymentId = await LatestPaymentIdAsync();

        var response = await _staff.PostAsJsonAsync(
            $"/api/staff/front-counter/payments/{paymentId}/void",
            new { reason = "Charged the wrong customer" });

        response.EnsureSuccessStatusCode();
        await _api.UseDbAsync(async context =>
        {
            var order = await context.Orders.AsNoTracking().SingleAsync(item => item.Id == _readyOrderId);
            // The sale still stands; the money does not.
            Assert.Equal(PaymentStatus.Unpaid, order.PaymentStatus);
            Assert.Equal(OrderStatus.Completed, order.Status);
        });
    }

    private async Task AssertNothingWasTakenAsync() =>
        await _api.UseDbAsync(async context =>
            Assert.Equal(0, await FrontCounterScenario.CounterPaymentTotalAsync(context, _readyOrderId)));

    private async Task<Guid> LatestPaymentIdAsync()
    {
        Guid paymentId = Guid.Empty;
        await _api.UseDbAsync(async context =>
        {
            paymentId = await context.Payments
                .AsNoTracking()
                .Where(payment => payment.OrderId == _readyOrderId)
                .OrderByDescending(payment => payment.CreatedAt)
                .Select(payment => payment.Id)
                .FirstAsync();
        });
        return paymentId;
    }

    private sealed record TakeawayPayload(List<OrderSummary> Orders);
    private sealed record OrderSummary(string OrderNumber, string Status, string PaymentStatus);
    private sealed record RecordPaymentPayload(OrderSummary Order, decimal AmountReceived, decimal ChangeDue);
}
