using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The demo option table is written in the rupees this menu started in, and it is matched to dishes
/// by name — so the same figures land on a restaurant trading in rupees and on one trading in
/// dollars.
///
/// <para>
/// The DineFlow Kitchen moved to Australia: its dish prices and its order history were converted,
/// but its options were not, and options are seeded after that migration runs. The result was a
/// A$24 butter chicken offering a A$150 garlic naan and a A$7 lassi offering a A$280 "Large" —
/// found while checking that an order's total matched the menu.
/// </para>
/// </summary>
public sealed class SeededOptionPriceCurrencyTests
{
    private static AppDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"option-prices-{Guid.NewGuid()}")
            .Options);

    private static async Task<AppDbContext> WithMenuAsync(string currency, decimal storedAdjustment)
    {
        var context = NewContext();
        var restaurantId = Guid.NewGuid();
        var menuItemId = Guid.NewGuid();
        var groupId = Guid.NewGuid();

        context.Restaurants.Add(new RestaurantEntity
        {
            Id = restaurantId,
            Name = "Test Kitchen",
            Currency = currency,
        });
        context.MenuItems.Add(new MenuItem
        {
            Id = menuItemId,
            RestaurantId = restaurantId,
            Name = "Butter Chicken",
            Price = 24m,
        });
        context.MenuItemOptionGroups.Add(new MenuItemOptionGroup
        {
            Id = groupId,
            MenuItemId = menuItemId,
            RestaurantId = restaurantId,
            Name = "Side",
            IsActive = true,
        });
        context.MenuItemOptions.Add(new MenuItemOption
        {
            Id = Guid.NewGuid(),
            GroupId = groupId,
            MenuItemId = menuItemId,
            RestaurantId = restaurantId,
            Name = "Garlic naan",
            PriceAdjustment = storedAdjustment,
            AdjustmentType = OptionAdjustmentType.Add,
        });

        await context.SaveChangesAsync();
        return context;
    }

    private static decimal AdjustmentIn(AppDbContext context) =>
        context.MenuItemOptions.Single().PriceAdjustment;

    /// <summary>150 rupees against a A$24 dish is the bug, in one row.</summary>
    [Fact]
    public async Task AnAustralianMenuHasItsRupeeOptionPricesConverted()
    {
        await using var context = await WithMenuAsync("AUD", 150m);

        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);

        Assert.Equal(5.56m, AdjustmentIn(context));
    }

    /// <summary>A restaurant still trading in rupees is already correct and must be left alone.</summary>
    [Fact]
    public async Task ARupeeMenuIsLeftAsItIs()
    {
        await using var context = await WithMenuAsync("INR", 150m);

        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);

        Assert.Equal(150m, AdjustmentIn(context));
    }

    /// <summary>
    /// The one that matters most: dividing what is stored, rather than the constant, would halve the
    /// price again on every restart until the naan was free.
    /// </summary>
    [Fact]
    public async Task RunningItTwiceConvertsOnlyOnce()
    {
        await using var context = await WithMenuAsync("AUD", 150m);

        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);
        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);
        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);

        Assert.Equal(5.56m, AdjustmentIn(context));
    }

    /// <summary>
    /// A price the restaurant has since set itself is not a seeded rupee figure, and rewriting it
    /// would overrule a decision — the same restraint the opening-hours and stock baselines show.
    /// </summary>
    [Fact]
    public async Task APriceSomebodyHasEditedIsNotTouched()
    {
        await using var context = await WithMenuAsync("AUD", 6.50m);

        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);

        Assert.Equal(6.50m, AdjustmentIn(context));
    }

    /// <summary>An option the seed table never mentions has no rupee figure to recognise.</summary>
    [Fact]
    public async Task AnOptionTheSeedDoesNotKnowIsNotTouched()
    {
        await using var context = await WithMenuAsync("AUD", 150m);
        var option = context.MenuItemOptions.Single();
        option.Name = "Chef's own extra";
        await context.SaveChangesAsync();

        await IdentitySeeder.ConvertSeededOptionPricesToLocalCurrencyAsync(context);

        Assert.Equal(150m, AdjustmentIn(context));
    }
}
