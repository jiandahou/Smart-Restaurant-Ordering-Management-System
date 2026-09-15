using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Reading a cart and checking one out answered "can this be ordered?" differently. The snapshot
/// looked at two things — visible, sold out — and reported them as separate flags with no verdict
/// between them. Checkout looked at six, adding the dish's restaurant and the state of its
/// category, and the snapshot did not even load the category, so four of those conditions were
/// invisible to a read.
///
/// <para>
/// The result: a line whose section had been archived read back as perfectly fine and was refused
/// at the till, and a sold-out line came back as <c>isAvailable: true</c> beside
/// <c>isSoldOut: true</c> — both true, and neither of them the answer.
/// </para>
/// </summary>
public sealed class CartLineAvailabilityTests
{
    private static readonly Guid RestaurantId = Guid.NewGuid();

    private static MenuItem Dish(Action<MenuItem>? adjust = null)
    {
        var item = new MenuItem
        {
            RestaurantId = RestaurantId,
            Name = "Veg Spring Rolls",
            IsAvailable = true,
            IsSoldOut = false,
            Category = new MenuCategory { RestaurantId = RestaurantId, IsActive = true },
        };

        adjust?.Invoke(item);
        return item;
    }

    [Fact]
    public void AnOrdinaryDishCanBeOrdered()
    {
        var availability = CartLineAvailability.Evaluate(Dish(), RestaurantId);

        Assert.True(availability.IsOrderable);
        Assert.Null(availability.Reason);
    }

    [Fact]
    public void ASoldOutDishCannot()
    {
        var availability = CartLineAvailability.Evaluate(Dish(item => item.IsSoldOut = true), RestaurantId);

        Assert.False(availability.IsOrderable);
        Assert.Contains("sold out", availability.Reason!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ADishTakenOffTheMenuCannot()
    {
        var availability = CartLineAvailability.Evaluate(Dish(item => item.IsAvailable = false), RestaurantId);

        Assert.False(availability.IsOrderable);
        Assert.Contains("off the menu", availability.Reason!, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The four conditions a cart read used to be blind to. Each one made checkout refuse a line the
    /// cart had shown as fine.
    /// </summary>
    [Fact]
    public void ADishWhoseSectionWasArchivedCannot()
    {
        var availability = CartLineAvailability.Evaluate(
            Dish(item => item.Category!.IsActive = false),
            RestaurantId);

        Assert.False(availability.IsOrderable);
        Assert.Contains("menu section", availability.Reason!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ADishWithNoCategoryLoadedIsTreatedAsUnavailable()
    {
        // Not loading the category is precisely how this check gets skipped without anyone noticing,
        // so an absent one counts against the line rather than being waved through.
        var availability = CartLineAvailability.Evaluate(Dish(item => item.Category = null), RestaurantId);

        Assert.False(availability.IsOrderable);
    }

    [Fact]
    public void ADishBelongingToAnotherRestaurantCannot()
    {
        var availability = CartLineAvailability.Evaluate(
            Dish(item => item.RestaurantId = Guid.NewGuid()),
            RestaurantId);

        Assert.False(availability.IsOrderable);
    }

    [Fact]
    public void ADishWhoseCategoryBelongsToAnotherRestaurantCannot()
    {
        var availability = CartLineAvailability.Evaluate(
            Dish(item => item.Category!.RestaurantId = Guid.NewGuid()),
            RestaurantId);

        Assert.False(availability.IsOrderable);
    }

    [Fact]
    public void ADishThatIsGoneEntirelyCannot()
    {
        var availability = CartLineAvailability.Evaluate(null, RestaurantId);

        Assert.False(availability.IsOrderable);
        Assert.NotNull(availability.Reason);
    }

    [Fact]
    public void EveryRefusalSaysWhy()
    {
        // "Unavailable" alone does not tell a customer whether to wait, choose something else, or
        // ask a member of staff.
        MenuItem?[] refused =
        [
            null,
            Dish(item => item.IsSoldOut = true),
            Dish(item => item.IsAvailable = false),
            Dish(item => item.Category!.IsActive = false),
            Dish(item => item.RestaurantId = Guid.NewGuid()),
        ];

        foreach (var item in refused)
        {
            var availability = CartLineAvailability.Evaluate(item, RestaurantId);

            Assert.False(availability.IsOrderable);
            Assert.False(string.IsNullOrWhiteSpace(availability.Reason));
        }
    }

    /// <summary>
    /// Both sides ask the same question of the same rule. Two copies is how they drifted apart the
    /// first time.
    /// </summary>
    [Fact]
    public void TheReadAndTheCheckoutShareOneRule()
    {
        var snapshot = File.ReadAllText(Path.Combine(SolutionDirectory(), "DineFlow.Api", "Services", "CartAccessService.cs"));
        var controller = File.ReadAllText(Path.Combine(SolutionDirectory(), "DineFlow.Api", "Controllers", "PublicCartsController.cs"));

        Assert.Contains("CartLineAvailability.Evaluate", snapshot, StringComparison.Ordinal);
        Assert.Contains("CartLineAvailability.Evaluate", controller, StringComparison.Ordinal);
    }

    /// <summary>The rule reads the category, so the query that feeds it has to load one.</summary>
    [Fact]
    public void TheCartSnapshotLoadsTheCategoryItJudges()
    {
        var snapshot = File.ReadAllText(Path.Combine(SolutionDirectory(), "DineFlow.Api", "Services", "CartAccessService.cs"));

        Assert.Contains("item!.Category", snapshot, StringComparison.Ordinal);
    }

    private static string SolutionDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
