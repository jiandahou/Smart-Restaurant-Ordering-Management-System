using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The DineFlow Kitchen was seeded in Kathmandu, and Stripe does not operate in Nepal — so the one
/// demo restaurant people reach for first could never connect Stripe, however many times they tried.
/// </summary>
public sealed class RestaurantOneAustraliaMigrationTests
{
    private static readonly Guid RestaurantOne = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task TheRestaurantMovesToACountryStripeOperatesIn()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var restaurant = await db.Restaurants.FirstAsync(r => r.Id == RestaurantOne);
        Assert.Equal("AU", restaurant.CountryCode);
        Assert.Equal("AUD", restaurant.Currency);
        Assert.Equal("Australia/Adelaide", restaurant.Timezone);
        Assert.DoesNotContain("Kathmandu", restaurant.Address!, StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("+61", restaurant.Phone!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Relabelling the currency without repricing would put A$250 spring rolls on the menu. These
    /// are Australian prices, not converted rupees.
    /// </summary>
    [Fact]
    public async Task DishesArePricedForTheNewCountryRatherThanConverted()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var rolls = await db.MenuItems.FirstAsync(i => i.Name == "Veg Spring Rolls");
        Assert.Equal(9.50m, rolls.Price);
        Assert.All(
            await db.MenuItems.Where(i => i.RestaurantId == RestaurantOne).ToListAsync(),
            item => Assert.True(item.Price < 100m, $"{item.Name} still looks like a rupee price"));
    }

    /// <summary>
    /// The history was rupees. Left alone it would report A$9,250 dinners in the revenue figures.
    /// </summary>
    [Fact]
    public async Task OrderHistoryIsBroughtIntoTheSameCurrency()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var order = await db.Orders.Include(o => o.OrderItems).FirstAsync();
        Assert.True(order.TotalAmount < 200m, $"total {order.TotalAmount} still looks like rupees");
        Assert.All(order.OrderItems, line => Assert.True(line.UnitPrice < 100m));
    }

    /// <summary>
    /// A receipt whose lines do not add up to its own total is worse than one priced in the wrong
    /// currency, so the total is rebuilt from the lines rather than scaled separately.
    /// </summary>
    [Fact]
    public async Task TheTotalStillEqualsTheSumOfItsLines()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var order = await db.Orders.Include(o => o.OrderItems).FirstAsync();
        Assert.Equal(order.OrderItems.Sum(line => line.UnitPrice * line.Quantity), order.TotalAmount);
    }

    [Fact]
    public async Task PaymentsFollowTheOrderTheyBelongTo()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var order = await db.Orders.Include(o => o.Payments).FirstAsync();
        var payment = order.Payments.First();
        Assert.Equal("aud", payment.Currency);
        Assert.Equal((long)Math.Round(order.TotalAmount * 100m), payment.AmountCents);
    }

    /// <summary>
    /// Keyed on the country still being NP, so a developer who already moved the restaurant — or
    /// repriced its menu — does not have it rewritten under them on the next start.
    /// </summary>
    [Fact]
    public async Task ARestaurantAlreadyMovedIsLeftAlone()
    {
        await using var db = await BuildNepaleseDemoAsync();
        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        var rolls = await db.MenuItems.FirstAsync(i => i.Name == "Veg Spring Rolls");
        rolls.Price = 11.00m;
        await db.SaveChangesAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        Assert.Equal(11.00m, (await db.MenuItems.FirstAsync(i => i.Name == "Veg Spring Rolls")).Price);
    }

    [Fact]
    public async Task RunningTwiceDoesNotScaleTheHistoryTwice()
    {
        await using var db = await BuildNepaleseDemoAsync();

        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);
        var afterFirst = (await db.Orders.FirstAsync()).TotalAmount;
        await IdentitySeeder.MigrateRestaurantOneToAustraliaAsync(db);

        Assert.Equal(afterFirst, (await db.Orders.FirstAsync()).TotalAmount);
    }

    /// A demo menu as it stood in Nepal: rupee prices, rupee order history.
    private static async Task<AppDbContext> BuildNepaleseDemoAsync()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"np-to-au-{Guid.NewGuid():N}")
            .Options);

        db.Restaurants.Add(new RestaurantEntity
        {
            Id = RestaurantOne,
            Name = "The DineFlow Kitchen",
            Address = "42 Flavor Street, Kathmandu 44600",
            Phone = "+977-1-4567890",
            CountryCode = "NP",
            Timezone = "Asia/Kathmandu",
            Currency = "NPR",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        });

        var rollsId = Guid.NewGuid();
        db.MenuItems.AddRange(
            new MenuItem { Id = rollsId, RestaurantId = RestaurantOne, CategoryId = Guid.NewGuid(), Name = "Veg Spring Rolls", Price = 250m, IsAvailable = true, CreatedAt = DateTime.UtcNow },
            new MenuItem { Id = Guid.NewGuid(), RestaurantId = RestaurantOne, CategoryId = Guid.NewGuid(), Name = "Grilled Salmon", Price = 950m, IsAvailable = true, CreatedAt = DateTime.UtcNow });

        var orderId = Guid.NewGuid();
        var order = new Order
        {
            Id = orderId,
            RestaurantId = RestaurantOne,
            OrderNumber = "ORD-DEMO-1",
            OrderType = OrderType.Takeaway,
            Status = OrderStatus.Completed,
            PaymentStatus = PaymentStatus.Paid,
            TotalAmount = 1450m,
            CreatedAt = DateTime.UtcNow,
        };
        order.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = orderId,
            MenuItemId = rollsId,
            MenuItemNameSnapshot = "Veg Spring Rolls",
            Quantity = 2,
            UnitPrice = 250m,
            CreatedAt = DateTime.UtcNow,
        });
        order.Payments.Add(new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = orderId,
            Provider = PaymentProviders.Stripe,
            AmountCents = 145000,
            Currency = "npr",
            Status = PaymentStatus.Paid,
            CreatedAt = DateTime.UtcNow,
        });
        db.Orders.Add(order);

        await db.SaveChangesAsync();
        return db;
    }
}
