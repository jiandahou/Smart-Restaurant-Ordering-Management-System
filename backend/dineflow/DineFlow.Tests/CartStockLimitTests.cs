using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Stock is reserved at checkout, not when a cart is filled, so this is a warning rather than a
/// reservation. Without it a customer chose every option and pressed pay before being told the
/// dish had one portion and they had asked for two.
/// </summary>
public class CartStockLimitTests
{
    [Fact]
    public void AnUnlimitedDishIsAlwaysAllowed()
    {
        var result = CartStockLimit.Evaluate(stockQuantity: null, alreadyInCart: 99, requested: 99);

        Assert.True(result.IsAllowed);
        Assert.Null(result.Remaining);
    }

    [Fact]
    public void AskingForWhatIsThereIsAllowed()
    {
        Assert.True(CartStockLimit.Evaluate(3, alreadyInCart: 0, requested: 3).IsAllowed);
        Assert.True(CartStockLimit.Evaluate(3, alreadyInCart: 1, requested: 2).IsAllowed);
    }

    [Fact]
    public void AskingForMoreThanIsThereIsRefused()
    {
        Assert.False(CartStockLimit.Evaluate(1, alreadyInCart: 0, requested: 2).IsAllowed);
        Assert.False(CartStockLimit.Evaluate(3, alreadyInCart: 0, requested: 4).IsAllowed);
    }

    /// <summary>
    /// "One more" on a cart that already holds the last portion is still asking for two. Counting
    /// only the line being added is how a cart quietly ends up over the limit.
    /// </summary>
    [Fact]
    public void WhatTheCartAlreadyHoldsCounts()
    {
        var result = CartStockLimit.Evaluate(1, alreadyInCart: 1, requested: 1);

        Assert.False(result.IsAllowed);
        Assert.Equal(1, result.AlreadyInCart);
    }

    [Fact]
    public void ADishThatRanOutRefusesEverything()
    {
        Assert.False(CartStockLimit.Evaluate(0, alreadyInCart: 0, requested: 1).IsAllowed);
    }

    /// A stored count below zero is a bug elsewhere; it must not read as negative availability.
    [Fact]
    public void ANegativeCountIsTreatedAsNothingLeft()
    {
        var result = CartStockLimit.Evaluate(-3, alreadyInCart: 0, requested: 1);

        Assert.False(result.IsAllowed);
        Assert.Equal(0, result.Remaining);
    }

    [Fact]
    public void TheRefusalNamesTheDishAndWhatIsActuallyLeft()
    {
        Assert.Equal(
            "Only 1 portion of Tandoori Platter left.",
            CartStockLimit.Evaluate(1, alreadyInCart: 0, requested: 2).DescribeRefusal("Tandoori Platter"));

        Assert.Equal(
            "Only 3 portions of Garlic Bread left.",
            CartStockLimit.Evaluate(3, alreadyInCart: 0, requested: 5).DescribeRefusal("Garlic Bread"));
    }

    /// Otherwise "only 1 left" reads as a contradiction to somebody who already holds that one.
    [Fact]
    public void TheRefusalMentionsWhatIsAlreadyInTheCart()
    {
        Assert.Equal(
            "Only 1 portion of Tandoori Platter left, and your cart already has 1.",
            CartStockLimit.Evaluate(1, alreadyInCart: 1, requested: 1).DescribeRefusal("Tandoori Platter"));
    }

    [Fact]
    public void ADishThatSoldOutSaysSoRatherThanOfferingZero()
    {
        Assert.Equal(
            "Daily Soup has just sold out.",
            CartStockLimit.Evaluate(0, alreadyInCart: 0, requested: 1).DescribeRefusal("Daily Soup"));
    }
}
