using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Stripe;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Tests;

/// <summary>
/// A refund taken through Stripe settles an order the same way one handed back at the counter does.
/// </summary>
/// <remarks>
/// <para>
/// Against a real database, because the release runs raw SQL inside a transaction and neither of
/// those exists in an in-memory provider — a test there would pass while releasing nothing, which is
/// the exact failure this is here to catch.
/// </para>
/// <para>
/// Stripe itself is stubbed. The point is not that Stripe refunds money; it is what this code does
/// once it has.
/// </para>
/// </remarks>
public sealed class StripeRefundClosesOrderTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _orderId;
    private Guid _menuItemId;

    private const string ActorId = "stripe-refund-admin";
    private const long PaymentAmountCents = 4_000;
    private const int StartingStock = 12;
    private const int OrderedQuantity = 4;

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
            Name = "Online Refund Kitchen",
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
            Name = "Chicken Wings",
            Price = 10m,
            StockQuantity = StartingStock - OrderedQuantity,
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            OrderNumber = "ORD-ONLINE-REFUND-1",
            // Accepted: nothing has left the pass, so the reservation is still a reservation.
            Status = OrderStatus.Accepted,
            PaymentMethod = PaymentMethod.Online,
            PaymentStatus = PaymentStatus.Paid,
            TotalAmount = 40m,
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
            Provider = PaymentProviders.Stripe,
            ProviderPaymentIntentId = "pi_online_refund",
            StripeAccountId = "acct_online_refund",
            AmountCents = PaymentAmountCents,
            Currency = "aud",
            Status = PaymentStatus.Paid,
            PaidAt = DateTime.UtcNow,
        };

        context.Users.Add(new ApplicationUser
        {
            Id = ActorId,
            UserName = "admin@test.local",
            NormalizedUserName = "ADMIN@TEST.LOCAL",
            Email = "admin@test.local",
        });
        context.Restaurants.Add(restaurant);
        context.MenuCategories.Add(category);
        context.MenuItems.Add(menuItem);
        context.Orders.Add(order);
        context.Payments.Add(payment);
        await context.SaveChangesAsync();

        _orderId = order.Id;
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
        var order = await context.Orders
            .Include(o => o.OrderItems)
            .Include(o => o.Payments)
                .ThenInclude(p => p.Refunds)
            .SingleAsync(o => o.Id == _orderId);

        var stripe = new StubStripeClient().Answering(
            "/v1/refunds",
            new Refund
            {
                Id = $"re_{Guid.NewGuid():N}",
                Status = "succeeded",
                Amount = amountCents,
                Currency = "aud",
            });

        var processor = new OrderRefundProcessor(
            context,
            stripe,
            Options.Create(new StripeOptions { SecretKey = "sk_test_online_refund" }),
            TestServiceStubs.CreateOrderRealtimeNotifier(),
            TestServiceStubs.CreatePaymentNotificationService(context),
            TestServiceStubs.CreateReportLogWriter(context),
            TestServiceStubs.CreateRefundedOrderCloser(context),
            NullLogger<OrderRefundProcessor>.Instance);

        var result = await processor.RefundAsync(
            order,
            ActorId,
            "customer asked to cancel",
            "test",
            CancellationToken.None,
            idempotencyKeySeed: $"test-{Guid.NewGuid():N}",
            requestedAmountCents: amountCents);

        Assert.True(result.IsSuccess, result.Message);
    }

    /// <summary>
    /// The gap this fixes: the online path settled the money and left the order reading Accepted,
    /// still holding its portions, with nothing downstream that would ever release them.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AFullOnlineRefundClosesTheOrderAndReleasesItsStock()
    {
        var before = await ReadAsync();
        Assert.Equal(StartingStock - OrderedQuantity, before.Stock);
        Assert.Null(before.ReleasedAt);

        await RefundAsync(PaymentAmountCents);

        var after = await ReadAsync();
        Assert.Equal(OrderStatus.Cancelled, after.Status);
        Assert.Equal(StartingStock, after.Stock);
        Assert.NotNull(after.ReleasedAt);
    }

    /// <summary>
    /// A partial refund settles nothing: the order can still be completed, so it still needs what
    /// it reserved and keeps its place in the kitchen.
    /// </summary>
    [RequiresPostgresFact]
    public async Task APartialOnlineRefundChangesNeitherTheOrderNorTheStock()
    {
        await RefundAsync(PaymentAmountCents / 4);

        var after = await ReadAsync();
        Assert.Equal(OrderStatus.Accepted, after.Status);
        Assert.Equal(StartingStock - OrderedQuantity, after.Stock);
        Assert.Null(after.ReleasedAt);
    }

    /// <summary>
    /// Once the food exists a full refund is redress after the fact, and rewriting the order as
    /// cancelled would record a day the kitchen did not have.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AFullOnlineRefundAfterTheFoodExistsLeavesTheOrderAlone()
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
        Assert.Equal(StartingStock - OrderedQuantity, after.Stock);
        Assert.Null(after.ReleasedAt);
    }
}
