using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Two closing paths can reach the same order together. Both may have loaded the old null marker,
/// but only one transaction may give its reserved portions back.
/// </summary>
public sealed class OrderStockReleaseConcurrencyTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private readonly Guid _orderId = Guid.NewGuid();
    private readonly Guid _itemId = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();
        var restaurantId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();

        context.Restaurants.Add(new RestaurantEntity
        {
            Id = restaurantId,
            Name = "Atomic Release Kitchen",
            Currency = "aud",
            Timezone = "Australia/Adelaide",
            IsActive = true
        });
        context.MenuCategories.Add(new MenuCategory
        {
            Id = categoryId,
            RestaurantId = restaurantId,
            Name = "Limited"
        });
        context.MenuItems.Add(new MenuItem
        {
            Id = _itemId,
            RestaurantId = restaurantId,
            CategoryId = categoryId,
            Name = "Last Portions",
            Price = 10m,
            StockQuantity = 7
        });
        context.Orders.Add(new Order
        {
            Id = _orderId,
            RestaurantId = restaurantId,
            OrderNumber = $"REL-{Guid.NewGuid():N}",
            Status = OrderStatus.Pending,
            StockReleasedAt = null,
            OrderItems =
            [
                new OrderItem
                {
                    MenuItemId = _itemId,
                    MenuItemNameSnapshot = "Last Portions",
                    BasePriceSnapshot = 10m,
                    UnitPrice = 10m,
                    Quantity = 2
                }
            ]
        });
        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    [RequiresPostgresFact]
    public async Task TwoStaleTransactionsGiveThePortionsBackOnlyOnce()
    {
        await using var firstContext = _database.CreateContext();
        await using var secondContext = _database.CreateContext();
        await using var firstTransaction = await firstContext.Database.BeginTransactionAsync();
        await using var secondTransaction = await secondContext.Database.BeginTransactionAsync();

        // Deliberately load both copies before either claims the release. Both tracked entities now
        // carry the stale null value that made the former in-memory guard unsafe.
        var firstOrder = await firstContext.Orders
            .Include(order => order.OrderItems)
            .ThenInclude(item => item.SelectedOptions)
            .SingleAsync(order => order.Id == _orderId);
        var secondOrder = await secondContext.Orders
            .Include(order => order.OrderItems)
            .ThenInclude(item => item.SelectedOptions)
            .SingleAsync(order => order.Id == _orderId);

        var firstLedger = new OrderStockLedger(firstContext, new MenuItemStockService(firstContext));
        var secondLedger = new OrderStockLedger(secondContext, new MenuItemStockService(secondContext));

        Assert.True(await firstLedger.ReleaseAsync(firstOrder, DateTime.UtcNow, CancellationToken.None));

        // PostgreSQL blocks this conditional UPDATE on the first transaction's row lock. Committing
        // lets it re-evaluate the predicate against the new timestamp rather than trust its stale
        // entity, at which point it must lose the claim.
        var secondRelease = secondLedger.ReleaseAsync(secondOrder, DateTime.UtcNow, CancellationToken.None);
        await firstContext.SaveChangesAsync();
        await firstTransaction.CommitAsync();

        Assert.False(await secondRelease);
        await secondContext.SaveChangesAsync();
        await secondTransaction.CommitAsync();

        await using var verification = _database.CreateContext();
        Assert.Equal(9, await verification.MenuItems
            .Where(item => item.Id == _itemId)
            .Select(item => item.StockQuantity)
            .SingleAsync());
        Assert.NotNull(await verification.Orders
            .Where(order => order.Id == _orderId)
            .Select(order => order.StockReleasedAt)
            .SingleAsync());
    }
}
