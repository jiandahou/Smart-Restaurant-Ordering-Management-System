using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public static class OrderPaymentEligibility
{
    public static bool IsSettledForFulfillment(PaymentStatus status) =>
        status is PaymentStatus.Paid
            or PaymentStatus.PartiallyRefunded
            or PaymentStatus.NotRequired;

    public static bool CanProcess(PaymentMethod method, PaymentStatus status) =>
        status != PaymentStatus.Refunded
        && (method == PaymentMethod.PayAtCounter || IsSettledForFulfillment(status));

    public static bool IsPayableOnlineStatus(PaymentStatus status) =>
        status is PaymentStatus.Pending
            or PaymentStatus.Unpaid
            or PaymentStatus.Failed
            or PaymentStatus.Cancelled
            or PaymentStatus.Expired;

    public static bool IsCounterPaymentDue(PaymentMethod method, PaymentStatus status) =>
        method == PaymentMethod.PayAtCounter && IsPayableOnlineStatus(status);

    /// <summary>
    /// Whether cash may still be taken over the counter for this order.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The counter endpoint knew all of this and no screen did, so Admin Orders offered "Mark paid"
    /// on a cancelled order while Admin Payments, three clicks away, called the same order not
    /// payable. Both were reading the order; only one of them was reading the rule. An action that
    /// is always refused is worse than a missing one — someone takes the money at the till first
    /// and finds out afterwards that the system will not record it.
    /// </para>
    /// <para>
    /// Completed is deliberately allowed. A customer who eats first and pays on the way out is the
    /// ordinary case for pay-at-counter, not an anomaly.
    /// </para>
    /// </remarks>
    public static bool CanSettleAtCounter(
        PaymentMethod method,
        PaymentStatus paymentStatus,
        OrderStatus orderStatus) =>
        method == PaymentMethod.PayAtCounter
        && !IsSettledForFulfillment(paymentStatus)
        && paymentStatus != PaymentStatus.Refunded
        && orderStatus is not (OrderStatus.Cancelled or OrderStatus.Rejected);

    /// <summary>Why not, in the words the till operator needs.</summary>
    public static string DescribeCounterRefusal(
        PaymentMethod method,
        PaymentStatus paymentStatus,
        OrderStatus orderStatus) =>
        method != PaymentMethod.PayAtCounter
            ? "Only pay-at-counter orders can be settled at the counter."
            : paymentStatus == PaymentStatus.Refunded
                ? "Fully refunded orders cannot be charged again."
                : orderStatus is OrderStatus.Cancelled or OrderStatus.Rejected
                    ? "Cancelled or rejected orders cannot be settled."
                    : "This order has already been settled.";
}
