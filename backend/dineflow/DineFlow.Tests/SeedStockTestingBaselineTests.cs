using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// Every seeded dish used to have no stock count at all, so the stock system could not be tried by
/// hand without editing the database first. The demo menu now covers each state that behaves
/// differently — untracked, comfortable, low, last portion, and empty.
/// </summary>
public sealed class SeedStockTestingBaselineTests
{
    private static readonly Guid RestaurantOne = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task BaselineCoversEveryStockStateWorthTesting()
    {
        await using var dbContext = await BuildMenuAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var items = await LoadAsync(dbContext);
        var tracked = items.Where(item => item.StockQuantity is not null).ToList();

        Assert.Contains(items, item => item.StockQuantity is null);   // untracked: never runs out
        Assert.Contains(tracked, item => item.StockQuantity == 0);    // empty
        Assert.Contains(tracked, item => item.StockQuantity == 1);    // last portion
        Assert.Contains(tracked, item => item.StockQuantity == 2);    // empties in one order
        Assert.Contains(tracked, item => item.StockQuantity is > 2 and <= 6);
        Assert.Contains(tracked, item => item.StockQuantity > 20);
    }

    /// A dish can be stopped by hand while portions remain; the flag has to win over the count.
    [Fact]
    public async Task BaselineIncludesADishSoldOutDespiteHavingStock()
    {
        await using var dbContext = await BuildMenuAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var items = await LoadAsync(dbContext);
        Assert.Contains(items, item => item.IsSoldOut && item.StockQuantity > 0);
        Assert.Contains(items, item => item.IsSoldOut && item.StockQuantity == 0);
    }

    /// <summary>
    /// A database seeded before these dishes existed would otherwise be missing exactly the cases
    /// worth trying, because the demo menu is only ever built against an empty database.
    /// </summary>
    [Fact]
    public async Task DishesThatExistOnlyForStockTestingAreAddedToAnOlderDatabase()
    {
        await using var dbContext = await BuildMenuAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var names = (await LoadAsync(dbContext)).Select(item => item.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Contains("Kitchen Staple Dal", names);
        Assert.Contains("Tandoori Platter", names);
        Assert.Contains("Daily Soup", names);
        Assert.Contains("Seasonal Sorbet", names);
    }

    [Fact]
    public async Task RunningTwiceDoesNotDuplicateTheTestingDishes()
    {
        await using var dbContext = await BuildMenuAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);
        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var soups = (await LoadAsync(dbContext)).Count(item => item.Name == "Daily Soup");
        Assert.Equal(1, soups);
    }

    /// <summary>
    /// Stock is operational data. Rewriting it on every start would wipe out whatever state a test
    /// was halfway through — counts set by hand, or drawn down by ordering.
    /// </summary>
    [Fact]
    public async Task StockAlreadySetByHandIsLeftAlone()
    {
        await using var dbContext = await BuildMenuAsync();
        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var wings = await dbContext.MenuItems.FirstAsync(item => item.Name == "Chicken Wings");
        wings.StockQuantity = 7;
        await dbContext.SaveChangesAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        Assert.Equal(7, (await LoadAsync(dbContext)).First(item => item.Name == "Chicken Wings").StockQuantity);
    }

    /// The same condition is how a developer starts over: clear every count and it rebuilds.
    [Fact]
    public async Task ClearingEveryCountRebuildsTheBaseline()
    {
        await using var dbContext = await BuildMenuAsync();
        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        foreach (var item in await dbContext.MenuItems.ToListAsync())
        {
            item.StockQuantity = null;
        }
        await dbContext.SaveChangesAsync();

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        Assert.Contains(await LoadAsync(dbContext), item => item.StockQuantity is not null);
    }

    /// A menu whose categories were renamed is the developer's own, not something to invent into.
    [Fact]
    public async Task MissingCategoriesAreNotInvented()
    {
        await using var dbContext = await BuildMenuAsync(includeCategories: false);

        await IdentitySeeder.SeedStockTestingBaselineAsync(dbContext);

        var names = (await LoadAsync(dbContext)).Select(item => item.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("Daily Soup", names);
        Assert.Empty(await dbContext.MenuCategories.ToListAsync());
    }

    private static Task<List<MenuItem>> LoadAsync(AppDbContext dbContext) =>
        dbContext.MenuItems.AsNoTracking().Where(item => item.RestaurantId == RestaurantOne).ToListAsync();

    /// The parts of the demo menu the baseline actually touches, without the users and orders.
    private static async Task<AppDbContext> BuildMenuAsync(bool includeCategories = true)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"stock-baseline-{Guid.NewGuid():N}")
            .Options;
        var dbContext = new AppDbContext(options);

        dbContext.Restaurants.Add(new RestaurantEntity
        {
            Id = RestaurantOne,
            Name = "The DineFlow Kitchen",
            Currency = "NPR",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        });

        var categoryIds = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

        if (includeCategories)
        {
            foreach (var (name, order) in new[] { ("Starters", 1), ("Main Course", 2), ("Drinks", 3), ("Desserts", 4) })
            {
                var id = Guid.NewGuid();
                categoryIds[name] = id;
                dbContext.MenuCategories.Add(new MenuCategory
                {
                    Id = id,
                    RestaurantId = RestaurantOne,
                    Name = name,
                    DisplayOrder = order,
                    IsActive = true
                });
            }
        }

        // The dishes the baseline names, as they were before any stock existed.
        foreach (var (name, category) in new[]
                 {
                     ("Veg Spring Rolls", "Starters"), ("Chicken Wings", "Starters"), ("Garlic Bread", "Starters"),
                     ("Butter Chicken", "Main Course"), ("Veg Fried Rice", "Main Course"),
                     ("Grilled Salmon", "Main Course"), ("Chef's Tasting Curry", "Main Course"),
                     ("Mango Lassi", "Drinks"), ("Masala Chai", "Drinks"), ("Fresh Lime Soda", "Drinks"),
                     ("Gulab Jamun", "Desserts"), ("Chocolate Lava Cake", "Desserts"),
                 })
        {
            dbContext.MenuItems.Add(new MenuItem
            {
                Id = Guid.NewGuid(),
                RestaurantId = RestaurantOne,
                CategoryId = categoryIds.TryGetValue(category, out var categoryId) ? categoryId : Guid.NewGuid(),
                Name = name,
                Price = 100,
                IsAvailable = true,
                StockQuantity = null,
                CreatedAt = DateTime.UtcNow
            });
        }

        await dbContext.SaveChangesAsync();
        return dbContext;
    }
}
