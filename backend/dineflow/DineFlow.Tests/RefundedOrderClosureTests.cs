using DineFlow.Infrastructure.Orders;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A fully refunded order that still reads as Accepted tells the kitchen to cook it and the customer
/// that they have their money back. The kitchen cannot see the contradiction, because the refund
/// lives on a different screen from the order.
/// </summary>
public class RefundedOrderClosureTests
{
    [Theory]
    [InlineData(OrderStatus.Pending)]
    [InlineData(OrderStatus.Accepted)]
    [InlineData(OrderStatus.Preparing)]
    public void AnOrderNobodyHasBeenGivenYetIsCalledOff(OrderStatus current)
    {
        Assert.Equal(OrderStatus.Cancelled, RefundedOrderClosure.ClosureFor(current, 2_550, 2_550));
    }

    /// <summary>
    /// The food exists and may already have been eaten. A full refund here is redress after the
    /// fact, and rewriting the order as cancelled would record a day the restaurant did not have.
    /// </summary>
    [Theory]
    [InlineData(OrderStatus.Ready)]
    [InlineData(OrderStatus.Completed)]
    public void AnOrderAlreadyHandedOverKeepsItsHistory(OrderStatus current)
    {
        Assert.Null(RefundedOrderClosure.ClosureFor(current, 2_550, 2_550));
    }

    /// <summary>A partial refund settles a complaint about one dish; the rest of the order stands.</summary>
    [Fact]
    public void APartialRefundDoesNotCallOffTheOrder()
    {
        Assert.Null(RefundedOrderClosure.ClosureFor(OrderStatus.Accepted, 2_550, 1_000));
    }

    /// <summary>Refunds accumulate: the last one can be what finally settles the whole order.</summary>
    [Fact]
    public void RefundsThatTogetherCoverTheOrderCloseIt()
    {
        Assert.True(RefundedOrderClosure.IsFullyRefunded(2_550, 2_550));
        Assert.Equal(OrderStatus.Cancelled, RefundedOrderClosure.ClosureFor(OrderStatus.Accepted, 2_550, 2_550));
    }

    /// <summary>An over-refund is still a full refund, not a reason to leave the order live.</summary>
    [Fact]
    public void RefundingMoreThanWasPaidStillClosesIt()
    {
        Assert.Equal(OrderStatus.Cancelled, RefundedOrderClosure.ClosureFor(OrderStatus.Accepted, 2_550, 3_000));
    }

    /// <summary>Nothing was paid, so nothing came back, and there is no refund to act on.</summary>
    [Fact]
    public void AnOrderThatWasNeverPaidIsNotClosedByThisRule()
    {
        Assert.False(RefundedOrderClosure.IsFullyRefunded(0, 0));
        Assert.Null(RefundedOrderClosure.ClosureFor(OrderStatus.Accepted, 0, 0));
    }

    /// <summary>An order that is already closed is not closed again.</summary>
    [Theory]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void AClosedOrderIsLeftAlone(OrderStatus current)
    {
        Assert.Null(RefundedOrderClosure.ClosureFor(current, 2_550, 2_550));
    }
}
