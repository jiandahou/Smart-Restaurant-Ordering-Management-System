using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Restaurant;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The diner who chose to pay online, never did, and then walked up to the counter with cash.
/// </summary>
/// <remarks>
/// <para>
/// It is an ordinary evening at a restaurant: a tab closed, a flat phone, a customer who decided
/// they would rather just hand over a note. The order sits unpaid and the kitchen is stopped on
/// purpose, because the money is unresolved. Every staff screen used to offer one thing to do about
/// it — reject the order and key it in again — while the till showed nothing owing, because nothing
/// is owed at the till until the order says that is where it will be paid.
/// </para>
/// <para>
/// Through the API rather than against the rule, because what was missing was never the rule. The
/// customer's own phone could already make this exact change; the endpoint behind it simply would
/// not answer to anyone else, and that is a question about routing and authorisation that only the
/// pipeline can answer.
/// </para>
/// </remarks>
public sealed class AbandonedOnlineOrderPaidAtCounterTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private readonly Guid _prepayRestaurantId = Guid.NewGuid();
    private readonly Guid _otherRestaurantId = Guid.NewGuid();

    private Guid _abandonedOrderId;
    private Guid _midCheckoutOrderId;
    private Guid _paidOrderId;
    private Guid _prepayOrderId;
    private Guid _theirOrderId;

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
            var prepayOnly = FrontCounterScenario.Restaurant(_prepayRestaurantId, "Prepay Only Kitchen");
            prepayOnly.PaymentPolicy = RestaurantPaymentPolicy.PrepayRequired;

            context.Restaurants.AddRange(
                FrontCounterScenario.Restaurant(_restaurantId, "Counter Kitchen"),
                prepayOnly,
                FrontCounterScenario.Restaurant(_otherRestaurantId, "Someone Else's Kitchen"));

            var abandoned = AbandonedOnline(_restaurantId, "API-ABANDONED");
            _abandonedOrderId = abandoned.Id;

            // Still on the card form as far as anybody knows.
            var midCheckout = AbandonedOnline(_restaurantId, "API-MID-CHECKOUT");
            midCheckout.PaymentStatus = PaymentStatus.Pending;
            midCheckout.Payments.Add(new Payment
            {
                Id = Guid.NewGuid(),
                Provider = PaymentProviders.Stripe,
                Status = PaymentStatus.Pending,
                AmountCents = 2_550,
                Currency = "aud",
            });
            _midCheckoutOrderId = midCheckout.Id;

            var paid = AbandonedOnline(_restaurantId, "API-ALREADY-PAID");
            paid.PaymentStatus = PaymentStatus.Paid;
            _paidOrderId = paid.Id;

            var prepay = AbandonedOnline(_prepayRestaurantId, "API-PREPAY");
            _prepayOrderId = prepay.Id;

            var theirs = AbandonedOnline(_otherRestaurantId, "API-THEIRS");
            _theirOrderId = theirs.Id;

            context.Orders.AddRange(abandoned, midCheckout, paid, prepay, theirs);
            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("counter-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    /// <summary>An order that chose online payment and never completed it.</summary>
    private static Order AbandonedOnline(Guid restaurantId, string number) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurantId,
        OrderNumber = number,
        OrderType = OrderType.Takeaway,
        // Pending, because the kitchen is not allowed to start while the money is unresolved.
        Status = OrderStatus.Pending,
        PaymentStatus = PaymentStatus.Unpaid,
        PaymentMethod = PaymentMethod.Online,
        TotalAmount = 25.50m,
        CreatedAt = DateTime.UtcNow.AddMinutes(-5),
    };

    private Task<HttpResponseMessage> SwitchAsync(Guid orderId, HttpClient? client = null) =>
        (client ?? _staff).PostAsync(
            $"/api/staff/front-counter/orders/{orderId}/pay-at-counter",
            content: null);

    private async Task<Order> ReadAsync(Guid orderId)
    {
        Order? order = null;
        await _api.UseDbAsync(async context =>
            order = await context.Orders.AsNoTracking().SingleAsync(item => item.Id == orderId));
        return order!;
    }

    /// <summary>
    /// The whole point: afterwards the till is owed the money, and the kitchen may start.
    /// </summary>
    [RequiresPostgresFact]
    public async Task TheCounterCanTakeCashForAnOrderThatGaveUpOnPayingOnline()
    {
        var before = await ReadAsync(_abandonedOrderId);
        Assert.Equal(0m, FrontCounterOrderPolicy.AmountDue(
            before.TotalAmount, before.PaymentMethod, before.PaymentStatus));

        Assert.Equal(HttpStatusCode.OK, (await SwitchAsync(_abandonedOrderId)).StatusCode);

        var after = await ReadAsync(_abandonedOrderId);
        Assert.Equal(PaymentMethod.PayAtCounter, after.PaymentMethod);
        Assert.Equal(25.50m, FrontCounterOrderPolicy.AmountDue(
            after.TotalAmount, after.PaymentMethod, after.PaymentStatus));
        Assert.True(OrderPaymentEligibility.IsCounterPaymentDue(after.PaymentMethod, after.PaymentStatus));
    }

    /// <summary>
    /// The money was the only thing stopping the kitchen, so the order goes to the pass rather than
    /// waiting for a second person to accept it.
    /// </summary>
    [RequiresPostgresFact]
    public async Task TheKitchenIsReleasedWithoutAnybodyAcceptingItAgain()
    {
        await _api.UseDbAsync(async context =>
        {
            var restaurant = await context.Restaurants.SingleAsync(item => item.Id == _restaurantId);
            restaurant.AutoAcceptOrders = true;
            await context.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.OK, (await SwitchAsync(_abandonedOrderId)).StatusCode);

        Assert.Equal(OrderStatus.Accepted, (await ReadAsync(_abandonedOrderId)).Status);
    }

    /// <summary>
    /// The refusal that protects money. A live checkout session may be taking payment at this very
    /// second, and switching underneath it is how somebody pays twice for one dinner.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ItWillNotStepInFrontOfACheckoutThatIsStillRunning()
    {
        var response = await SwitchAsync(_midCheckoutOrderId);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("pending", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(PaymentMethod.Online, (await ReadAsync(_midCheckoutOrderId)).PaymentMethod);
    }

    /// <summary>Money already taken is not owed at the till, and must not be asked for again.</summary>
    [RequiresPostgresFact]
    public async Task ItWillNotPutAPaidOrderInFrontOfTheTill()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await SwitchAsync(_paidOrderId)).StatusCode);
        Assert.Equal(PaymentMethod.Online, (await ReadAsync(_paidOrderId)).PaymentMethod);
    }

    /// <summary>
    /// A restaurant that requires payment up front has decided it does not take money at the door,
    /// and the counter does not get to overrule that.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ItRespectsARestaurantThatDoesNotTakeMoneyAtTheCounter()
    {
        var prepayStaff = await _api.SignInAsAsync(
            "prepay-staff@dineflow.test",
            ApplicationRoles.Staff,
            _prepayRestaurantId);

        Assert.Equal(HttpStatusCode.Conflict, (await SwitchAsync(_prepayOrderId, prepayStaff)).StatusCode);
        Assert.Equal(PaymentMethod.Online, (await ReadAsync(_prepayOrderId)).PaymentMethod);
    }

    /// <summary>Pressing it twice is the same order, not an error to interpret at a busy counter.</summary>
    [RequiresPostgresFact]
    public async Task PressingItTwiceIsHarmless()
    {
        Assert.Equal(HttpStatusCode.OK, (await SwitchAsync(_abandonedOrderId)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SwitchAsync(_abandonedOrderId)).StatusCode);

        Assert.Equal(PaymentMethod.PayAtCounter, (await ReadAsync(_abandonedOrderId)).PaymentMethod);
    }

    // ---- who may do it ------------------------------------------------------------------------

    [RequiresPostgresFact]
    public async Task AStrangerCannotChangeHowAnOrderIsPaidFor()
    {
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await SwitchAsync(_abandonedOrderId, _api.CreateClient())).StatusCode);
        Assert.Equal(PaymentMethod.Online, (await ReadAsync(_abandonedOrderId)).PaymentMethod);
    }

    /// <summary>Staff reach their own restaurant's orders and nobody else's.</summary>
    [RequiresPostgresFact]
    public async Task StaffCannotReachAnotherRestaurantsOrders()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await SwitchAsync(_theirOrderId)).StatusCode);
        Assert.Equal(PaymentMethod.Online, (await ReadAsync(_theirOrderId)).PaymentMethod);
    }

    /// <summary>
    /// Someone will want to know why the evening's takings have a cash sale that was booked online.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ItLeavesAnAuditRecordNamingWhoDecided()
    {
        Assert.Equal(HttpStatusCode.OK, (await SwitchAsync(_abandonedOrderId)).StatusCode);

        await _api.UseDbAsync(async context =>
        {
            var entityId = _abandonedOrderId.ToString();
            var audit = await context.AuditLogs
                .AsNoTracking()
                .Where(log => log.EntityId == entityId)
                .ToListAsync();

            var record = Assert.Single(audit, log => log.Action == "Order.SwitchedToCounterPayment");
            Assert.False(string.IsNullOrWhiteSpace(record.ActorUserId));
        });
    }
}
