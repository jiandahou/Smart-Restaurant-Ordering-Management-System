using DineFlow.Infrastructure.Orders;
using Xunit;

namespace DineFlow.Tests;

public class OrderStatusTransitionsTests
{
    [Theory]
    [InlineData(OrderStatus.Pending, OrderTransitionAction.Accept, OrderStatus.Accepted)]
    [InlineData(OrderStatus.Accepted, OrderTransitionAction.StartPreparing, OrderStatus.Preparing)]
    [InlineData(OrderStatus.Preparing, OrderTransitionAction.MarkReady, OrderStatus.Ready)]
    [InlineData(OrderStatus.Ready, OrderTransitionAction.Complete, OrderStatus.Completed)]
    [InlineData(OrderStatus.Pending, OrderTransitionAction.Reject, OrderStatus.Rejected)]
    [InlineData(OrderStatus.Preparing, OrderTransitionAction.Cancel, OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Cancelled, OrderTransitionAction.Reopen, OrderStatus.Pending)]
    [InlineData(OrderStatus.Completed, OrderTransitionAction.Reopen, OrderStatus.Ready)]
    public void TryGetNextStatus_ValidTransition_ReturnsNextStatus(
        OrderStatus current,
        OrderTransitionAction action,
        OrderStatus expected)
    {
        var succeeded = OrderStatusTransitions.TryGetNextStatus(current, action, out var next);

        Assert.True(succeeded);
        Assert.Equal(expected, next);
    }

    [Theory]
    [InlineData(OrderStatus.Completed, OrderTransitionAction.Accept)]
    [InlineData(OrderStatus.Preparing, OrderTransitionAction.Accept)]
    [InlineData(OrderStatus.Ready, OrderTransitionAction.StartPreparing)]
    [InlineData(OrderStatus.Rejected, OrderTransitionAction.Cancel)]
    public void TryGetNextStatus_InvalidTransition_ReturnsFalseAndKeepsStatus(
        OrderStatus current,
        OrderTransitionAction action)
    {
        var succeeded = OrderStatusTransitions.TryGetNextStatus(current, action, out var next);

        Assert.False(succeeded);
        Assert.Equal(current, next);
    }

    [Theory]
    [InlineData(OrderTransitionAction.Reject)]
    [InlineData(OrderTransitionAction.Cancel)]
    [InlineData(OrderTransitionAction.Reopen)]
    public void RequiresReason_IsTrue_ForReasonBearingActions(OrderTransitionAction action)
        => Assert.True(OrderStatusTransitions.RequiresReason(action));

    [Theory]
    [InlineData(OrderTransitionAction.Accept)]
    [InlineData(OrderTransitionAction.StartPreparing)]
    [InlineData(OrderTransitionAction.MarkReady)]
    [InlineData(OrderTransitionAction.Complete)]
    public void RequiresReason_IsFalse_ForForwardActions(OrderTransitionAction action)
        => Assert.False(OrderStatusTransitions.RequiresReason(action));

    [Fact]
    public void RequiresPaymentEligibility_GatesKitchenProgressionOnly()
    {
        Assert.True(OrderStatusTransitions.RequiresPaymentEligibility(OrderTransitionAction.Accept));
        Assert.True(OrderStatusTransitions.RequiresPaymentEligibility(OrderTransitionAction.Complete));
        Assert.False(OrderStatusTransitions.RequiresPaymentEligibility(OrderTransitionAction.Cancel));
        Assert.False(OrderStatusTransitions.RequiresPaymentEligibility(OrderTransitionAction.Reject));
    }

    [Fact]
    public void GetAvailableActions_TerminalStates_OnlyAllowReopen()
    {
        Assert.Equal(new[] { OrderTransitionAction.Reopen }, OrderStatusTransitions.GetAvailableActions(OrderStatus.Completed));
        Assert.Equal(new[] { OrderTransitionAction.Reopen }, OrderStatusTransitions.GetAvailableActions(OrderStatus.Cancelled));
        Assert.Equal(new[] { OrderTransitionAction.Reopen }, OrderStatusTransitions.GetAvailableActions(OrderStatus.Rejected));
    }
}
