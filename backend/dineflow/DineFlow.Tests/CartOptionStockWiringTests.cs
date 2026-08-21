using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The rule existing is not the same as the cart applying it. Modifier stock was already tracked,
/// reserved at checkout and published on the menu — the only missing step was the cart consulting
/// it, and that is exactly the step whose absence nothing noticed.
/// </summary>
public sealed class CartOptionStockWiringTests
{
    [Fact]
    public void AddingAnItemChecksItsModifiersBeforeWritingTheLine()
    {
        var body = MemberBody("HttpPost(\"{cartId:guid}/items\")");

        var checkedAt = body.IndexOf("CartOptionStockLimit.Evaluate", StringComparison.Ordinal);
        var written = body.IndexOf("dbContext.CartItems.AddAsync", StringComparison.Ordinal);

        Assert.True(checkedAt >= 0, "Adding an item never checks modifier stock.");
        Assert.True(written > checkedAt, "The line is written before its modifiers are checked.");
    }

    [Fact]
    public void EditingALineChecksItsModifiersToo()
    {
        // The other way a quantity grows, and the one the dish check already had to cover.
        var body = MemberBody("HttpPut(\"{cartId:guid}/items/{cartItemId:guid}\")");

        Assert.Contains("CartOptionStockLimit.Evaluate", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AnEditLeavesItsOwnLineOutOfTheCount()
    {
        // An edit replaces the line rather than adding to it. Counted as competing with itself, a
        // line already holding the last portions can only ever be reduced.
        var body = MemberBody("HttpPut(\"{cartId:guid}/items/{cartItemId:guid}\")");
        var units = body.IndexOf("CartOptionStockLimit.UnitsInCart", StringComparison.Ordinal);

        Assert.True(units >= 0, "The edit path does not count what the rest of the cart holds.");

        // Bounded to that one query. The same exclusion appears further down for a different
        // purpose, and searching the whole method finds it there and calls the check present.
        var query = body[units..(units + 200)];

        Assert.Contains("cartItem.Id != cartItemId", query, StringComparison.Ordinal);
    }

    [Fact]
    public void AddingCountsTheWholeCart()
    {
        // Adding asks for more on top of everything already there, including the matching line.
        var body = MemberBody("HttpPost(\"{cartId:guid}/items\")");
        var units = body.IndexOf("CartOptionStockLimit.UnitsInCart", StringComparison.Ordinal);

        Assert.True(units >= 0, "The add path does not count what the cart already holds.");

        var query = body[units..(units + 260)];

        Assert.DoesNotContain("!= cartItemId", query, StringComparison.Ordinal);
    }

    [Fact]
    public void ARefusalIsDistinguishableFromADishRunningOut()
    {
        // The browser has to tell a customer which of the two ran out; one code for both cannot.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("insufficient_option_stock", source, StringComparison.Ordinal);
    }

    /// <summary>The source of one member, from its marker to the next one.</summary>
    private static string MemberBody(string marker)
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);

        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "PublicCartsController.cs");
    }
}
