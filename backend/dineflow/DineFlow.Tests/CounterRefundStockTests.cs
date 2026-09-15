using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// What a counter refund does to the portions the order was holding.
/// </summary>
/// <remarks>
/// <para>
/// A fully refunded order can never be charged or completed — the counter refuses both — so it can
/// never consume what it reserved. Left holding stock it takes those portions off the menu for
/// everyone else until somebody happens to cancel the order, and nothing obliges anyone to.
/// </para>
/// <para>
/// The dividing line is whether anything has been handed over, which is the rule
/// <see cref="DineFlow.Infrastructure.Orders.RefundedOrderClosure"/> already wrote down and only
/// one refund path was applying. Nothing has left the pass while an order is accepted, so a full
/// refund there means the order is off and its portions go back with it. Once it is ready the food
/// exists, and rewriting that as cancelled would record a day the kitchen did not have.
/// </para>
/// </remarks>
public sealed class CounterRefundStockTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _orderId;
    private Guid _paymentId;
    private Guid _menuItemId;

    private const string CashierId = "counter-refund-cashier";
    private const long PaymentAmountCents = 5_000;
    private const int StartingStock = 10;
    private const int OrderedQuantity = 3;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();

        var restaurant = new RestaurantEntity
        {
            Id = Guid.NewGuid(),
            Name = "Counter Refund Kitchen",
            Currency = "aud",
            Timezone = "Australia/Sydney",
            IsActive = true,
        };
        var category = new MenuCategory
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            Name = "Mains",
        };
        var menuItem = new MenuItem
        {
            Id = Guid.NewGuid(),
            CategoryId = category.Id,
            Name = "Garlic Bread",
            Price = 10m,
            // What the order already took when it was placed.
            StockQuantity = StartingStock - OrderedQuantity,
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            OrderNumber = "ORD-COUNTER-REFUND-1",
            // Accepted, not completed: the food has not been handed over, so the reservation is
            // still a reservation.
            Status = OrderStatus.Accepted,
            PaymentMethod = PaymentMethod.PayAtCounter,
            PaymentStatus = PaymentStatus.Paid,
            TotalAmount = 50m,
        };
        order.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            MenuItemId = menuItem.Id,
            MenuItemNameSnapshot = menuItem.Name,
            BasePriceSnapshot = menuItem.Price,
            UnitPrice = menuItem.Price,
            Quantity = OrderedQuantity,
        });
        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Provider = PaymentProviders.CounterCash,
            AmountCents = PaymentAmountCents,
            Currency = "aud",
            Status = PaymentStatus.Paid,
            TenderType = "Cash",
            PaidAt = DateTime.UtcNow,
        };

        // Real, because closing an order writes a status history row that references the actor —
        // a fake id fails the refund outright, which is itself worth knowing.
        context.Users.Add(new ApplicationUser
        {
            Id = CashierId,
            UserName = "cashier@test.local",
            NormalizedUserName = "CASHIER@TEST.LOCAL",
            Email = "cashier@test.local",
        });
        context.Restaurants.Add(restaurant);
        context.MenuCategories.Add(category);
        context.MenuItems.Add(menuItem);
        context.Orders.Add(order);
        context.Payments.Add(payment);
        await context.SaveChangesAsync();

        _orderId = order.Id;
        _paymentId = payment.Id;
        _menuItemId = menuItem.Id;
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    private async Task<(int Stock, DateTime? ReleasedAt, OrderStatus Status)> ReadAsync()
    {
        await using var context = _database.CreateContext();
        var item = await context.MenuItems.AsNoTracking().SingleAsync(m => m.Id == _menuItemId);
        var order = await context.Orders.AsNoTracking().SingleAsync(o => o.Id == _orderId);
        return (item.StockQuantity ?? 0, order.StockReleasedAt, order.Status);
    }

    private async Task RefundAsync(long amountCents)
    {
        await using var context = _database.CreateContext();
        var order = await context.Orders.SingleAsync(o => o.Id == _orderId);
        var payment = await context.Payments
            .Include(p => p.Refunds)
            .SingleAsync(p => p.Id == _paymentId);

        var result = await TestServiceStubs.CreateReversalService(context).RefundAsync(
            payment,
            order,
            amountCents,
            actorUserId: CashierId,
            reason: "customer changed their mind",
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Message);
    }

    /// <summary>
    /// The reported fault: money back, portions still gone. Nothing could ever consume them, because
    /// a fully refunded order cannot be completed.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AFullRefundGivesThePortionsBack()
    {
        var before = await ReadAsync();
        Assert.Equal(StartingStock - OrderedQuantity, before.Stock);
        Assert.Null(before.ReleasedAt);

        await RefundAsync(PaymentAmountCents);

        var after = await ReadAsync();
        Assert.Equal(StartingStock, after.Stock);
        Assert.NotNull(after.ReleasedAt);
    }

    /// <summary>
    /// Money and food have to agree. An order refunded in full while still accepted is off, and
    /// saying so is what stops the kitchen cooking something nobody has paid for.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AFullRefundBeforeAnythingIsHandedOverClosesTheOrder()
    {
        await RefundAsync(PaymentAmountCents);

        Assert.Equal(OrderStatus.Cancelled, (await ReadAsync()).Status);
    }

    /// <summary>
    /// Once the food exists a full refund is redress after the fact. Rewriting the order as
    /// cancelled would record something that did not happen, and every report built on the day's
    /// history would then disagree with the day the kitchen actually had.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AFullRefundAfterTheFoodExistsLeavesTheOrderAlone()
    {
        await using (var context = _database.CreateContext())
        {
            var ready = await context.Orders.SingleAsync(o => o.Id == _orderId);
            ready.Status = OrderStatus.Ready;
            await context.SaveChangesAsync();
        }

        await RefundAsync(PaymentAmountCents);

        var after = await ReadAsync();
        Assert.Equal(OrderStatus.Ready, after.Status);
        // The portions were consumed by food that exists, so they do not come back either.
        Assert.Equal(StartingStock - OrderedQuantity, after.Stock);
        Assert.Null(after.ReleasedAt);
    }

    /// <summary>
    /// A partial refund settles nothing. The order can still be completed, so it still needs what
    /// it reserved.
    /// </summary>
    [RequiresPostgresFact]
    public async Task APartialRefundKeepsThePortions()
    {
        await RefundAsync(PaymentAmountCents / 2);

        var after = await ReadAsync();
        Assert.Equal(StartingStock - OrderedQuantity, after.Stock);
        Assert.Null(after.ReleasedAt);
        Assert.Equal(OrderStatus.Accepted, after.Status);
    }

    /// <summary>
    /// Two refunds that together settle the order release once, not twice. Giving the same portions
    /// back a second time invents stock that never existed.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RefundingInTwoHalvesReleasesExactlyOnce()
    {
        await RefundAsync(PaymentAmountCents / 2);
        await RefundAsync(PaymentAmountCents / 2);

        Assert.Equal(StartingStock, (await ReadAsync()).Stock);

        // A later cancellation must not hand the portions back again.
        await using var context = _database.CreateContext();
        var order = await context.Orders.Include(o => o.OrderItems).SingleAsync(o => o.Id == _orderId);
        await TestServiceStubs.CreateStockLedger(context)
            .ReleaseAsync(order, DateTime.UtcNow, CancellationToken.None);
        await context.SaveChangesAsync();

        Assert.Equal(StartingStock, (await ReadAsync()).Stock);
    }
}
