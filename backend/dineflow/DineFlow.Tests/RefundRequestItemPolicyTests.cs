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

    [Fact]
    public void AllocateApprovedRefund_PrOratesAdjustedMultiItemApprovalToTheCent()
    {
        var firstId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var secondId = Guid.Parse("00000000-0000-0000-0000-000000000002");

        var result = RefundRequestItemPolicy.AllocateApprovedRefund(
            1_001,
            [
                new RefundItemAllocation(firstId, "First", 1, 1_500),
                new RefundItemAllocation(secondId, "Second", 1, 500)
            ]);

        Assert.Equal(1_001, result.Sum(item => item.AmountCents));
        Assert.Equal(751, result.Single(item => item.OrderItemId == firstId).AmountCents);
        Assert.Equal(250, result.Single(item => item.OrderItemId == secondId).AmountCents);
    }

    [Fact]
    public void AllocateApprovedRefund_PreservesEnteredLinesWhenFullyApproved()
    {
        var requested = new[]
        {
            new RefundItemAllocation(Guid.NewGuid(), "First", 2, 1_500),
            new RefundItemAllocation(Guid.NewGuid(), "Second", 1, 500)
        };

        var result = RefundRequestItemPolicy.AllocateApprovedRefund(2_000, requested);

        Assert.Equal(requested, result);
    }

    [Fact]
    public void AllocateApprovedRefund_RejectsAmountAboveSelectedItems()
    {
        var result = RefundRequestItemPolicy.AllocateApprovedRefund(
            501,
            [new RefundItemAllocation(Guid.NewGuid(), "Item", 1, 500)]);

        Assert.Empty(result);
    }

    /// <summary>
    /// Staff naming an amount per line is the whole point: it is how "the wings were cold, the
    /// spring rolls were fine" gets said. Before this the only lever was the total, and the split
    /// was worked out by proportion — figures nobody chose, which then became the balance every
    /// later refund on those lines was measured against.
    /// </summary>
    [Fact]
    public void AllocateStaffChosenRefund_TakesTheAmountStaffGaveEachLine()
    {
        var wings = Guid.NewGuid();
        var rolls = Guid.NewGuid();
        var requested = new List<RefundItemAllocation>
        {
            new(wings, "Chicken Wings", 1, 1_600),
            new(rolls, "Veg Spring Rolls", 1, 1_024),
        };

        var result = RefundRequestItemPolicy.AllocateStaffChosenRefund(
            requested,
            [(wings, 1_600), (rolls, 0)]);

        Assert.True(result.IsValid);
        Assert.Equal(1_600, result.ApprovedAmountCents);
        var only = Assert.Single(result.Allocations);
        Assert.Equal(wings, only.OrderItemId);
        Assert.Equal(1_600, only.AmountCents);
    }

    /// <summary>A line left out of the breakdown is a line staff chose not to refund.</summary>
    [Fact]
    public void AllocateStaffChosenRefund_DoesNotRefundLinesLeftOut()
    {
        var wings = Guid.NewGuid();
        var rolls = Guid.NewGuid();
        var requested = new List<RefundItemAllocation>
        {
            new(wings, "Chicken Wings", 1, 1_600),
            new(rolls, "Veg Spring Rolls", 1, 1_024),
        };

        var result = RefundRequestItemPolicy.AllocateStaffChosenRefund(requested, [(rolls, 500)]);

        Assert.True(result.IsValid);
        Assert.Equal(500, result.ApprovedAmountCents);
        Assert.Equal(rolls, Assert.Single(result.Allocations).OrderItemId);
    }

    /// <summary>
    /// Approving more than was asked for is not an adjustment; it refunds something nobody claimed.
    /// </summary>
    [Fact]
    public void AllocateStaffChosenRefund_RefusesMoreThanTheCustomerAskedForOnALine()
    {
        var wings = Guid.NewGuid();
        var requested = new List<RefundItemAllocation> { new(wings, "Chicken Wings", 1, 1_600) };

        var result = RefundRequestItemPolicy.AllocateStaffChosenRefund(requested, [(wings, 1_601)]);

        Assert.False(result.IsValid);
        Assert.Contains("Chicken Wings", result.Error);
        Assert.Empty(result.Allocations);
    }

    [Fact]
    public void AllocateStaffChosenRefund_RefusesLinesThatWereNeverRequested()
    {
        var requested = new List<RefundItemAllocation> { new(Guid.NewGuid(), "Chicken Wings", 1, 1_600) };

        var result = RefundRequestItemPolicy.AllocateStaffChosenRefund(requested, [(Guid.NewGuid(), 100)]);

        Assert.False(result.IsValid);
    }

    [Fact]
    public void AllocateStaffChosenRefund_RefusesNegativeAndDuplicateLines()
    {
        var wings = Guid.NewGuid();
        var requested = new List<RefundItemAllocation> { new(wings, "Chicken Wings", 1, 1_600) };

        Assert.False(RefundRequestItemPolicy.AllocateStaffChosenRefund(requested, [(wings, -1)]).IsValid);
        Assert.False(RefundRequestItemPolicy
            .AllocateStaffChosenRefund(requested, [(wings, 100), (wings, 200)]).IsValid);
    }

    /// <summary>Zeroing every line is a rejection, and should be made as one.</summary>
    [Fact]
    public void AllocateStaffChosenRefund_RefusesAnApprovalWorthNothing()
    {
        var wings = Guid.NewGuid();
        var requested = new List<RefundItemAllocation> { new(wings, "Chicken Wings", 1, 1_600) };

        var result = RefundRequestItemPolicy.AllocateStaffChosenRefund(requested, [(wings, 0)]);

        Assert.False(result.IsValid);
        Assert.Contains("reject", result.Error, StringComparison.OrdinalIgnoreCase);
    }
}
