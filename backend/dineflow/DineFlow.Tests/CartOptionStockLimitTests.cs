using DineFlow.Api.Services;
using DineFlow.Infrastructure.Carts;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A dish with two portions left could not be over-ordered; a sauce with two left could. The cart
/// checked the dish and said nothing at all about its modifiers, so three lots of an aioli with two
/// in stock went in, survived every screen, and were refused at payment — the one point where the
/// customer can no longer do anything about it.
///
/// <para>
/// Two ceilings apply and they are not the same ceiling. <c>MaxQuantity</c> is a recipe rule; stock
/// is what is left. Neither number alone explains a refusal, which is why both are named here.
/// </para>
/// </summary>
public sealed class CartOptionStockLimitTests
{
    private static readonly Guid Aioli = Guid.NewGuid();
    private static readonly Guid Truffle = Guid.NewGuid();

    private static CartOptionStockLimit.Request Request(Guid id, string name, int? stock, int perItem) =>
        new(id, name, stock, perItem);

    [Fact]
    public void AModifierMayNotBeTakenBeyondWhatIsLeft()
    {
        // The reported defect: allowed three per dish, only two in the kitchen.
        var shortages = CartOptionStockLimit.Evaluate(
            [Request(Aioli, "Last of the aioli", 2, 3)],
            dishQuantity: 1);

        var shortage = Assert.Single(shortages);
        Assert.Equal("Last of the aioli", shortage.Name);
        Assert.Equal(2, shortage.Remaining);
        Assert.Equal(3, shortage.Wanted);
    }

    [Fact]
    public void WhatTheRecipeAllowsIsStillAllowedWhenTheStockCoversIt()
    {
        Assert.Empty(CartOptionStockLimit.Evaluate(
            [Request(Truffle, "Truffle shavings", 3, 2)],
            dishQuantity: 1));
    }

    [Fact]
    public void TheDishQuantityMultipliesTheModifier()
    {
        // Two garlic breads each taking two lots consume four, not two. Counted unmultiplied this
        // passes, and every line still reads correctly on its own — the hardest shortage to explain.
        var shortages = CartOptionStockLimit.Evaluate(
            [Request(Truffle, "Truffle shavings", 3, 2)],
            dishQuantity: 2);

        Assert.Equal(4, Assert.Single(shortages).Wanted);
    }

    [Fact]
    public void TheRestOfTheCartCountsAgainstIt()
    {
        // One lot is fine on its own and not fine on top of two the cart already holds.
        var elsewhere = new Dictionary<Guid, int> { [Truffle] = 2 };

        Assert.Empty(CartOptionStockLimit.Evaluate(
            [Request(Truffle, "Truffle shavings", 3, 1)],
            dishQuantity: 1));
        Assert.Single(CartOptionStockLimit.Evaluate(
            [Request(Truffle, "Truffle shavings", 3, 1)],
            dishQuantity: 2,
            elsewhere));
    }

    [Fact]
    public void AnUncountedModifierHasNothingToRunOutOf()
    {
        Assert.Empty(CartOptionStockLimit.Evaluate(
            [Request(Aioli, "Garlic butter", null, 99)],
            dishQuantity: 50));
    }

    [Fact]
    public void EveryShortageIsNamed()
    {
        // Fixing one and being refused again for the next is a worse experience than being told both.
        var shortages = CartOptionStockLimit.Evaluate(
            [Request(Aioli, "Last of the aioli", 2, 3), Request(Truffle, "Truffle shavings", 1, 2)],
            dishQuantity: 1);

        Assert.Equal(2, shortages.Count);

        var message = CartOptionStockLimit.DescribeRefusal(shortages);

        Assert.Contains("Last of the aioli", message, StringComparison.Ordinal);
        Assert.Contains("Truffle shavings", message, StringComparison.Ordinal);
    }

    [Fact]
    public void ASoldOutModifierSaysSoRatherThanOfferingZero()
    {
        var shortages = CartOptionStockLimit.Evaluate(
            [Request(Aioli, "Last of the aioli", 0, 1)],
            dishQuantity: 1);

        Assert.Equal("'Last of the aioli' has just sold out.", CartOptionStockLimit.DescribeRefusal(shortages));
    }

    [Fact]
    public void ARefusalCausedByTheirOwnCartSaysWhereThePortionsWent()
    {
        // "Only 2 left" reads as a lie to someone looking at a cart that holds them.
        var shortages = CartOptionStockLimit.Evaluate(
            [Request(Truffle, "Truffle shavings", 3, 2)],
            dishQuantity: 1,
            new Dictionary<Guid, int> { [Truffle] = 2 });

        Assert.Contains("your cart already uses 2", CartOptionStockLimit.DescribeRefusal(shortages), StringComparison.Ordinal);
    }

    [Fact]
    public void CartLinesAreCountedTheWayTheOrderCountsThem()
    {
        // A line stores repeated ids, so two dishes each taking two lots commit four.
        var units = CartOptionStockLimit.UnitsInCart(
        [
            new CartItem { Quantity = 2, SelectedOptionIds = [Truffle, Truffle] },
            new CartItem { Quantity = 1, SelectedOptionIds = [Truffle, Aioli] },
        ]);

        Assert.Equal(5, units[Truffle]);
        Assert.Equal(1, units[Aioli]);
    }
}
