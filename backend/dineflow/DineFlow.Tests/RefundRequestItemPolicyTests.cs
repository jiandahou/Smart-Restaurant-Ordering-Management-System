using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class RefundRequestItemPolicyTests
{
    [Theory]
    [InlineData(1, 3, true)]
    [InlineData(3, 3, true)]
    [InlineData(0, 3, false)]
    [InlineData(-1, 3, false)]
    [InlineData(4, 3, false)]
    public void IsValidQuantity_MustBePositiveAndNotExceedLineQuantity(int requestedQuantity, int orderItemQuantity, bool expected)
    {
        Assert.Equal(expected, RefundRequestItemPolicy.IsValidQuantity(requestedQuantity, orderItemQuantity));
    }

    [Fact]
    public void HasAtLeastOneItem_FalseForEmptyCollection()
    {
        Assert.False(RefundRequestItemPolicy.HasAtLeastOneItem(Array.Empty<int>()));
    }

    [Fact]
    public void HasAtLeastOneItem_TrueForNonEmptyCollection()
    {
        Assert.True(RefundRequestItemPolicy.HasAtLeastOneItem(new[] { 1 }));
    }

    [Theory]
    [InlineData(1500, 1750, 1750, true)]
    [InlineData(250, 1750, 250, true)]
    [InlineData(0, 1750, 1750, false)]
    [InlineData(1800, 1750, 1750, false)]
    [InlineData(1500, 1750, 1000, false)]
    public void IsValidAmount_MustFitSelectedQuantityAndRemainingLine(
        long requested,
        long selectedQuantityAmount,
        long remainingLineAmount,
        bool expected)
    {
        Assert.Equal(
            expected,
            RefundRequestItemPolicy.IsValidAmount(requested, selectedQuantityAmount, remainingLineAmount));
    }

    [Theory]
    [InlineData(1500, 1750, 1, 0)]
    [InlineData(1750, 1750, 1, 1)]
    [InlineData(2000, 1600, 2, 1)]
    [InlineData(3200, 1600, 2, 2)]
    public void GetRefundedQuantity_CountsOnlyCompletelyRefundedUnits(
        long refundedAmount,
        long unitPrice,
        int orderQuantity,
        int expected)
    {
        Assert.Equal(expected, RefundRequestItemPolicy.GetRefundedQuantity(refundedAmount, unitPrice, orderQuantity));
    }

    [Fact]
    public void AttributeSucceededRefund_UsesEnteredAmountsWhenTheFullRequestWasApproved()
    {
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();

        var result = RefundRequestItemPolicy.AttributeSucceededRefund(
            2_000,
            [(firstId, 1_500), (secondId, 500)]);

        Assert.Equal([(firstId, 1_500L), (secondId, 500L)], result);
    }

    [Fact]
    public void AttributeSucceededRefund_AssignsAStaffAdjustedAmountWhenOnlyOneItemWasSelected()
    {
        var itemId = Guid.NewGuid();

        var result = RefundRequestItemPolicy.AttributeSucceededRefund(1_500, [(itemId, 1_750)]);

        Assert.Equal([(itemId, 1_500L)], result);
    }

    [Fact]
    public void AttributeSucceededRefund_DoesNotGuessHowToSplitAStaffAdjustedMultiItemRefund()
    {
        var result = RefundRequestItemPolicy.AttributeSucceededRefund(
            1_500,
            [(Guid.NewGuid(), 1_750), (Guid.NewGuid(), 3_200)]);

        Assert.Empty(result);
    }
}
