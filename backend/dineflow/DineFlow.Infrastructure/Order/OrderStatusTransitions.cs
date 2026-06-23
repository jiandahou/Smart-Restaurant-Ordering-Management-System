namespace DineFlow.Infrastructure.Orders;

public enum OrderTransitionAction
{
    Accept,
    StartPreparing,
    MarkReady,
    Complete,
    Reject,
    Cancel,
    Reopen
}

public static class OrderStatusTransitions
{
    public static IReadOnlyList<OrderTransitionAction> GetAvailableActions(OrderStatus status) => status switch
    {
        OrderStatus.Pending =>
        [
            OrderTransitionAction.Accept,
            OrderTransitionAction.MarkReady,
            OrderTransitionAction.Complete,
            OrderTransitionAction.Reject,
            OrderTransitionAction.Cancel
        ],
        OrderStatus.Accepted => [OrderTransitionAction.StartPreparing, OrderTransitionAction.Reject, OrderTransitionAction.Cancel],
        OrderStatus.Preparing => [OrderTransitionAction.MarkReady, OrderTransitionAction.Cancel],
        OrderStatus.Ready => [OrderTransitionAction.Complete, OrderTransitionAction.Cancel],
        OrderStatus.Completed => [OrderTransitionAction.Reopen],
        OrderStatus.Cancelled => [OrderTransitionAction.Reopen],
        OrderStatus.Rejected => [OrderTransitionAction.Reopen],
        _ => []
    };

    public static bool TryGetNextStatus(
        OrderStatus currentStatus,
        OrderTransitionAction action,
        out OrderStatus nextStatus)
    {
        var transition = (currentStatus, action) switch
        {
            (OrderStatus.Pending, OrderTransitionAction.Accept) => OrderStatus.Accepted,
            (OrderStatus.Pending, OrderTransitionAction.MarkReady) => OrderStatus.Ready,
            (OrderStatus.Pending, OrderTransitionAction.Complete) => OrderStatus.Completed,
            (OrderStatus.Accepted, OrderTransitionAction.StartPreparing) => OrderStatus.Preparing,
            (OrderStatus.Preparing, OrderTransitionAction.MarkReady) => OrderStatus.Ready,
            (OrderStatus.Ready, OrderTransitionAction.Complete) => OrderStatus.Completed,
            (OrderStatus.Pending or OrderStatus.Accepted, OrderTransitionAction.Reject) => OrderStatus.Rejected,
            (OrderStatus.Pending or OrderStatus.Accepted or OrderStatus.Preparing or OrderStatus.Ready, OrderTransitionAction.Cancel) => OrderStatus.Cancelled,
            (OrderStatus.Rejected or OrderStatus.Cancelled, OrderTransitionAction.Reopen) => OrderStatus.Pending,
            (OrderStatus.Completed, OrderTransitionAction.Reopen) => OrderStatus.Ready,
            _ => (OrderStatus?)null
        };

        nextStatus = transition ?? currentStatus;
        return transition.HasValue;
    }

    public static bool RequiresPaymentEligibility(OrderTransitionAction action) => action is
        OrderTransitionAction.Accept or
        OrderTransitionAction.StartPreparing or
        OrderTransitionAction.MarkReady or
        OrderTransitionAction.Complete;

    public static bool RequiresReason(OrderTransitionAction action) => action is
        OrderTransitionAction.Reject or
        OrderTransitionAction.Cancel or
        OrderTransitionAction.Reopen;
}
