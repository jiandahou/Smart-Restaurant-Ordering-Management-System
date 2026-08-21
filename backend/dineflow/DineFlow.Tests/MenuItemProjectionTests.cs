using System.Linq.Expressions;
using System.Reflection;
using DineFlow.Api.Contracts.Menu;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Menu;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A menu item was projected into its response three times over — once for the list, once for the
/// single-item read, once for create and update — and the copies had drifted. Only the create and
/// update copy carried MayContainAllergens, CrossContactStatement and AllergenInfoLastVerifiedAt.
///
/// <para>
/// Nothing failed. Every read answered 200 with those fields set to null while the text sat in the
/// database, so the admin menu could not find an item by searching its "may contain" text, counted
/// it as having declared no allergens at all, and — because the edit form fills itself from that
/// read — wrote the nulls back over the real declaration the next time anyone pressed Save. An
/// allergen declaration that disappears when someone edits an unrelated field is the kind of defect
/// that ends in an ambulance, so it is worth a test that fails on the omission itself rather than
/// on any single one of its symptoms.
/// </para>
/// </summary>
public sealed class MenuItemProjectionTests
{
    /// <summary>
    /// Every field of the response is filled from the item. Written against the projection rather
    /// than a list of field names so that a column added later is covered without being remembered.
    /// </summary>
    [Fact]
    public void TheProjectionLeavesNoFieldOfTheResponseBehind()
    {
        var response = Project(FullyPopulatedItem());

        var unset = typeof(MenuItemResponse)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.CanWrite)
            .Where(property => IsDefault(property.GetValue(response)))
            .Select(property => property.Name)
            .ToArray();

        Assert.True(
            unset.Length == 0,
            $"The projection never reads: {string.Join(", ", unset)}. Every one of these is a field "
                + "the API silently reports as empty while it holds a value in the database.");
    }

    /// <summary>
    /// The three allergen disclosures are separate legal statements, and the one that went missing
    /// was the one no other field can stand in for. Named explicitly so a regression says so.
    /// </summary>
    [Fact]
    public void EveryAllergenDisclosureSurvivesTheProjection()
    {
        var response = Project(FullyPopulatedItem());

        Assert.Equal("Wheat, gluten", response.Allergens);
        Assert.Equal("Peanut, sesame", response.MayContainAllergens);
        Assert.Equal("Fried in oil shared with battered seafood.", response.CrossContactStatement);
        Assert.NotNull(response.AllergenInfoLastVerifiedAt);
    }

    /// <summary>
    /// The drift was only possible because the shape was written out more than once. One copy is
    /// the fix; a second copy anywhere in the controller is the bug coming back.
    /// </summary>
    [Fact]
    public void TheResponseShapeIsWrittenExactlyOnce()
    {
        var source = File.ReadAllText(ControllerPath());
        var copies = source.Split("new MenuItemResponse").Length - 1;

        Assert.True(copies == 1, $"The menu item response is built in {copies} places; it must be built in one.");
    }

    /// <summary>The create and update path names the category itself, and must keep doing so.</summary>
    [Fact]
    public void AWriteStillReportsTheCategoryItNamed()
    {
        var item = FullyPopulatedItem();
        item.Category = null;

        var mapToResponse = typeof(AdminMenuItemsController)
            .GetMethod("MapToResponse", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(mapToResponse);

        var response = (MenuItemResponse)mapToResponse!.Invoke(null, [item, "Starters"])!;

        Assert.Equal("Starters", response.CategoryName);
        Assert.Equal("Peanut, sesame", response.MayContainAllergens);
    }

    /// <summary>Runs the controller's own projection, whatever it is currently written as.</summary>
    private static MenuItemResponse Project(MenuItem item)
    {
        var field = typeof(AdminMenuItemsController)
            .GetField("ToResponse", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.True(field is not null, "AdminMenuItemsController.ToResponse is gone — has it been renamed?");

        var projection = (Expression<Func<MenuItem, MenuItemResponse>>)field!.GetValue(null)!;
        return projection.Compile()(item);
    }

    /// <summary>An item with nothing left at a default, so an unread field shows up as one.</summary>
    private static MenuItem FullyPopulatedItem() => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = Guid.NewGuid(),
        CategoryId = Guid.NewGuid(),
        Category = new MenuCategory { Name = "Starters" },
        Name = "Garlic Bread",
        Description = "Toasted sourdough",
        Price = 12.5m,
        ImageUrl = "https://example.test/garlic-bread.jpg",
        IsAvailable = true,
        IsSoldOut = true,
        IsWatched = true,
        StockQuantity = 4,
        IsVegetarian = true,
        IsVegan = true,
        IsGlutenFree = true,
        IsHalal = true,
        Allergens = "Wheat, gluten",
        MayContainAllergens = "Peanut, sesame",
        CrossContactStatement = "Fried in oil shared with battered seafood.",
        AllergenInfoLastVerifiedAt = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
        SpiceLevel = 2,
        ServingSize = "Serves 2",
        Calories = 620,
        IsPopular = true,
        IsRecommended = true,
        DisplayOrder = 30,
        CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        UpdatedAt = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
        OptionGroups =
        [
            new MenuItemOptionGroup
            {
                Id = Guid.NewGuid(),
                Name = "Size",
                IsRequired = true,
                MinSelections = 1,
                MaxSelections = 1,
                DisplayOrder = 10,
                IsActive = true,
                Options = [],
            },
        ],
    };

    /// <summary>True when a value is indistinguishable from one the projection never wrote.</summary>
    private static bool IsDefault(object? value) => value switch
    {
        null => true,
        string text => text.Length == 0,
        Guid id => id == Guid.Empty,
        bool flag => !flag,
        int number => number == 0,
        decimal number => number == 0,
        DateTime moment => moment == default,
        System.Collections.ICollection collection => collection.Count == 0,
        _ => false,
    };

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "AdminMenuItemsController.cs");
    }
}
