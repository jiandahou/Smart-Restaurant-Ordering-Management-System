using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Whether a finished order can still be charged online.
/// </summary>
/// <remarks>
/// Completed was missing from the refusals, so orders handed over while still owing money were shown
/// a Checkout button in Admin Payments and could be taken through to a real Stripe session. The rule
/// this settles: a completed order is not paid online. Money still owed on one is recorded at the
/// counter, where it is written down with a name against it, or the order is reopened first.
/// </remarks>
public sealed class CompletedOrderCheckoutTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly Guid _restaurantId = Guid.NewGuid();
    private Guid _completedUnpaidId;
    private Guid _readyUnpaidId;
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
            var restaurant = FrontCounterScenario.Restaurant(_restaurantId, "Checkout Kitchen");
            // Able to take a card, so the refusal under test is the one about the order rather than
            // the earlier one about the restaurant.
            restaurant.StripeAccountId = "acct_checkout_eligibility_test";
            restaurant.StripeChargesEnabled = true;
            context.Restaurants.Add(restaurant);

            var completed = Online("ELIG-COMPLETED", OrderStatus.Completed);
            _completedUnpaidId = completed.Id;
            var ready = Online("ELIG-READY", OrderStatus.Ready);
            _readyUnpaidId = ready.Id;

            context.Orders.AddRange(completed, ready);
            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("checkout-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    private Order Online(string number, OrderStatus status) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = _restaurantId,
        OrderNumber = number,
        Status = status,
        PaymentStatus = PaymentStatus.Unpaid,
        PaymentMethod = PaymentMethod.Online,
        TotalAmount = 10m,
        OrderItems =
        [
            new OrderItem
            {
                Id = Guid.NewGuid(),
                MenuItemNameSnapshot = "Garlic Bread",
                Quantity = 1,
                UnitPrice = 10m
            }
        ]
    };

    public Task DisposeAsync() => _api.DisposeAsync();

    private Task<HttpResponseMessage> StartCheckoutAsync(Guid orderId) =>
        _staff.PostAsJsonAsync("/api/payments/checkout-session/order", new { orderId });

    /// <summary>The case reported: handed over, still owing money, offered a checkout.</summary>
    [RequiresPostgresFact]
    public async Task RefusesToChargeACompletedOrderOnline()
    {
        var response = await StartCheckoutAsync(_completedUnpaidId);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("already been completed", await response.Content.ReadAsStringAsync());
    }

    /// <summary>And says what to do instead, rather than only saying no.</summary>
    [RequiresPostgresFact]
    public async Task SaysWhereTheMoneyIsRecordedInstead()
    {
        var response = await StartCheckoutAsync(_completedUnpaidId);

        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("counter", body);
        Assert.Contains("reopened", body);
    }

    /// <summary>
    /// An order still in service is untouched by this — the refusal is about being finished, not
    /// about owing money.
    /// </summary>
    [RequiresPostgresFact]
    public async Task LeavesAnOrderStillInServicePayable()
    {
        var response = await StartCheckoutAsync(_readyUnpaidId);

        // It gets past the eligibility rules and on to Stripe, which these tests have no real key
        // for. What matters is that it was not refused here.
        Assert.NotEqual(HttpStatusCode.Conflict, response.StatusCode);
    }

    /// <summary>Staff are not shown a button for something the server will refuse.</summary>
    [RequiresPostgresFact]
    public async Task StopsListingCompletedOrdersAsPayable()
    {
        var response = await _staff.GetAsync("/api/admin/orders?payableOnly=true&pageSize=100");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("ELIG-READY", body);
        Assert.DoesNotContain("ELIG-COMPLETED", body);
    }
}

/// <summary>The rule itself, stated once and checked directly.</summary>
public sealed class OnlineCheckoutEligibilityTests
{
    private static string? Refuse(OrderStatus status, PaymentStatus payment = PaymentStatus.Unpaid) =>
        OnlineCheckoutEligibility.Refuse(status, payment, PaymentMethod.Online);

    [Fact]
    public void AFinishedOrderIsNotPaidOnline()
    {
        Assert.NotNull(Refuse(OrderStatus.Completed));
        Assert.NotNull(Refuse(OrderStatus.Cancelled));
        Assert.NotNull(Refuse(OrderStatus.Rejected));
    }

    [Theory]
    [InlineData(OrderStatus.Pending)]
    [InlineData(OrderStatus.Accepted)]
    [InlineData(OrderStatus.Preparing)]
    [InlineData(OrderStatus.Ready)]
    public void AnOrderStillInServiceCanBePaid(OrderStatus status)
    {
        Assert.Null(Refuse(status));
    }

    [Fact]
    public void MoneyThatHasAlreadyMovedIsNotAskedForAgain()
    {
        Assert.NotNull(Refuse(OrderStatus.Ready, PaymentStatus.Paid));
        Assert.NotNull(Refuse(OrderStatus.Ready, PaymentStatus.PartiallyRefunded));
        Assert.NotNull(Refuse(OrderStatus.Ready, PaymentStatus.Refunded));
        Assert.NotNull(Refuse(OrderStatus.Ready, PaymentStatus.NotRequired));
    }

    [Fact]
    public void ACounterOrderIsSettledAtTheCounter()
    {
        Assert.NotNull(OnlineCheckoutEligibility.Refuse(
            OrderStatus.Ready, PaymentStatus.Unpaid, PaymentMethod.PayAtCounter));
    }
}
