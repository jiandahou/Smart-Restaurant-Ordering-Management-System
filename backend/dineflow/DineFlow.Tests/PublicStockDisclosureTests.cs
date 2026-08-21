using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A dish with one portion left used to look exactly like one with unlimited supply — the public
/// menu carried only a sold-out flag — so a customer could fill a cart with the last portion twice
/// over and only be turned away at checkout.
/// </summary>
public class PublicStockDisclosureTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(3)]
    [InlineData(5)]
    [InlineData(60)]
    [InlineData(500)]
    public void ALimitedDishPublishesItsCountHoweverManyAreLeft(int stock)
    {
        Assert.Equal(stock, PublicStockDisclosure.RemainingToPublish(stock, isSoldOut: false));
    }

    /// <summary>
    /// An unlimited dish has no shortage to warn about, and a badge on every dish would mean
    /// nothing.
    /// </summary>
    [Fact]
    public void AnUnlimitedDishSaysNothing()
    {
        Assert.Null(PublicStockDisclosure.RemainingToPublish(null, isSoldOut: false));
    }

    /// <summary>
    /// A kitchen that has stopped serving a dish still has portions of it. Showing the count beside
    /// "sold out" would contradict the thing the customer needs to believe.
    /// </summary>
    [Fact]
    public void ADishStoppedByHandShowsNoCountEvenWithPortionsLeft()
    {
        Assert.Null(PublicStockDisclosure.RemainingToPublish(12, isSoldOut: true));
    }

    [Fact]
    public void ADishThatRanOutSaysNothingBesidesBeingSoldOut()
    {
        Assert.Null(PublicStockDisclosure.RemainingToPublish(0, isSoldOut: true));
        Assert.Null(PublicStockDisclosure.RemainingToPublish(0, isSoldOut: false));
    }

    /// A negative count is a bug elsewhere; it must not surface as "-2 left".
    [Fact]
    public void ANegativeCountIsNotPublished()
    {
        Assert.Null(PublicStockDisclosure.RemainingToPublish(-2, isSoldOut: false));
    }
}
