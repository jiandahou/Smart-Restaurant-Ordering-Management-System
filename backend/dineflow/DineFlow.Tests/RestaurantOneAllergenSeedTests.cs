using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// Every seeded dish declared nothing about allergens, so the panel a customer reads before ordering
/// could only ever be seen in the one state it matters least to get right — "not declared by the
/// restaurant" — and the modifier disclosure, which exists because adding naan to a dairy-only curry
/// adds gluten, had nothing on the menu that could demonstrate it.
/// </summary>
public sealed class RestaurantOneAllergenSeedTests
{
    private static readonly Guid RestaurantOneId = new("11111111-1111-1111-1111-111111111111");

    private static AppDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"allergens-{Guid.NewGuid()}")
            .Options);

    private static async Task<AppDbContext> WithKitchenAsync()
    {
        var context = NewContext();
        context.Restaurants.Add(new RestaurantEntity
        {
            Id = RestaurantOneId,
            Name = "The DineFlow Kitchen",
            Currency = "AUD",
        });

        foreach (var (dish, group, option) in new[]
                 {
                     ("Butter Chicken", "Side", "Butter naan"),
                     ("Fresh Lime Soda", "Size", "Large"),
                     ("Kitchen Staple Dal", "Preparation", "Standard"),
                     ("Daily Soup", "Preparation", "Standard"),
                 })
        {
            var menuItemId = Guid.NewGuid();
            var groupId = Guid.NewGuid();

            context.MenuItems.Add(new MenuItem
            {
                Id = menuItemId,
                RestaurantId = RestaurantOneId,
                Name = dish,
                Price = 24m,
            });
            context.MenuItemOptionGroups.Add(new MenuItemOptionGroup
            {
                Id = groupId,
                MenuItemId = menuItemId,
                RestaurantId = RestaurantOneId,
                Name = group,
                IsActive = true,
            });
            context.MenuItemOptions.Add(new MenuItemOption
            {
                Id = Guid.NewGuid(),
                GroupId = groupId,
                MenuItemId = menuItemId,
                RestaurantId = RestaurantOneId,
                Name = option,
                AdjustmentType = OptionAdjustmentType.Add,
            });
        }

        await context.SaveChangesAsync();
        return context;
    }

    private static MenuItem Dish(AppDbContext context, string name) =>
        context.MenuItems.Single(item => item.Name == name);

    [Fact]
    public async Task ADishThatDeclaresAllergensGetsThem()
    {
        await using var context = await WithKitchenAsync();

        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);

        var butterChicken = Dish(context, "Butter Chicken");

        Assert.Equal("Milk, cashew (tree nut)", butterChicken.Allergens);
        Assert.Equal("Wheat (gluten)", butterChicken.MayContainAllergens);
        Assert.Contains("peanut", butterChicken.CrossContactStatement!, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The modifier panel's whole reason for existing: naan carries gluten that the curry does not.
    /// </summary>
    [Fact]
    public async Task AModifierDeclaresWhatItItselfContains()
    {
        await using var context = await WithKitchenAsync();

        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);

        var naan = context.MenuItemOptions.Single(option => option.Name == "Butter naan");

        Assert.Equal("Wheat (gluten), milk", naan.Allergens);
    }

    /// <summary>Each branch of the panel needs a dish on the menu that reaches it.</summary>
    [Fact]
    public async Task TheSpreadCoversEveryStateThePanelCanBeIn()
    {
        await using var context = await WithKitchenAsync();

        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);

        // May-contain only: no allergen is confirmed, so that warning is the whole answer.
        var dal = Dish(context, "Kitchen Staple Dal");
        Assert.True(string.IsNullOrEmpty(dal.Allergens));
        Assert.Equal("Milk", dal.MayContainAllergens);

        // A kitchen description but no allergen — this must not read as a declaration.
        var soup = Dish(context, "Daily Soup");
        Assert.True(string.IsNullOrEmpty(soup.Allergens));
        Assert.True(string.IsNullOrEmpty(soup.MayContainAllergens));
        Assert.False(string.IsNullOrEmpty(soup.CrossContactStatement));

        // The control: still nothing, so "not declared" stays reachable from the menu.
        var soda = Dish(context, "Fresh Lime Soda");
        Assert.True(string.IsNullOrEmpty(soda.Allergens));
        Assert.True(string.IsNullOrEmpty(soda.MayContainAllergens));
        Assert.True(string.IsNullOrEmpty(soda.CrossContactStatement));
    }

    /// <summary>
    /// A declaration the restaurant entered itself is a legal statement about their food. Seeding
    /// must never overwrite one.
    /// </summary>
    [Fact]
    public async Task ADeclarationTheRestaurantEnteredIsLeftAlone()
    {
        await using var context = await WithKitchenAsync();
        Dish(context, "Butter Chicken").Allergens = "Milk only, checked by the chef";
        await context.SaveChangesAsync();

        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);

        var butterChicken = Dish(context, "Butter Chicken");

        Assert.Equal("Milk only, checked by the chef", butterChicken.Allergens);
        Assert.True(string.IsNullOrEmpty(butterChicken.MayContainAllergens));
    }

    [Fact]
    public async Task RunningItAgainChangesNothing()
    {
        await using var context = await WithKitchenAsync();

        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);
        var afterFirst = Dish(context, "Butter Chicken").Allergens;
        await IdentitySeeder.SeedRestaurantOneAllergensAsync(context);

        Assert.Equal(afterFirst, Dish(context, "Butter Chicken").Allergens);
    }
}
