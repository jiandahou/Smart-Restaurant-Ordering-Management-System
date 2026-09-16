using DineFlow.Infrastructure.Menu;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Stock had a floor and no ceiling.
///
/// <para>
/// Adjustments are applied by the database in one statement on purpose — reading the count and
/// writing it back loses an increment when two people press the button at once — but that
/// statement was <c>StockQuantity + delta</c> against an <c>integer</c> column. A count sitting at
/// int.MaxValue adjusted by one raised PostgreSQL 22003 and the caller got a 500.
/// </para>
/// <para>
/// A ceiling fixes it without touching the atomic statement: with both the count and the step
/// held inside the range, the sum the database computes cannot leave it.
/// </para>
/// </summary>
public sealed class MenuStockPolicyTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(5_000)]
    [InlineData(MenuStockPolicy.MaximumStockQuantity)]
    public void AcceptsCountsAKitchenCouldHave(int quantity)
        => Assert.True(MenuStockPolicy.IsValidQuantity(quantity));

    [Theory]
    [InlineData(-1)]
    [InlineData(MenuStockPolicy.MaximumStockQuantity + 1)]
    [InlineData(int.MaxValue)]
    public void RefusesCountsOutsideTheRange(int quantity)
        => Assert.False(MenuStockPolicy.IsValidQuantity(quantity));

    /// A step larger than the whole permitted range is a typo whatever the current count is.
    [Theory]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    [InlineData(MenuStockPolicy.MaximumStockQuantity + 1)]
    public void RefusesAnAdjustmentBiggerThanTheRangeItself(int delta)
        => Assert.False(MenuStockPolicy.IsValidAdjustment(delta));

    /// <summary>The reported case: a count at the top of the column, adjusted by one.</summary>
    [Fact]
    public void TheReportedOverflowIsRefusedRatherThanRaised()
    {
        Assert.False(MenuStockPolicy.IsValidQuantity(int.MaxValue));
        Assert.True(MenuStockPolicy.WouldExceedMaximum(MenuStockPolicy.MaximumStockQuantity, 1));
    }

    /// <summary>
    /// Running out is ordinary and clamps to zero. Running past the top is not, and the caller is
    /// told rather than quietly capped, so an operator whose number meant something else finds out.
    /// </summary>
    [Fact]
    public void RunningOutClampsButRunningOverIsReported()
    {
        Assert.Equal(0, MenuStockPolicy.Apply(3, -10));
        Assert.False(MenuStockPolicy.WouldExceedMaximum(3, -10));

        Assert.True(MenuStockPolicy.WouldExceedMaximum(MenuStockPolicy.MaximumStockQuantity - 1, 2));
    }

    /// The check itself must not overflow the way the SQL addition did.
    [Fact]
    public void TheCheckIsDoneInWiderArithmeticThanTheColumn()
    {
        Assert.True(MenuStockPolicy.WouldExceedMaximum(int.MaxValue, int.MaxValue));
        Assert.Equal(MenuStockPolicy.MaximumStockQuantity, MenuStockPolicy.Apply(int.MaxValue, int.MaxValue));
    }
}
