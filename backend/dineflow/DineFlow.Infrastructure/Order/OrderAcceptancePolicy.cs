using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// FS-017. <see cref="OrderStatus.Pending"/> means two different things depending on whether the
/// money has arrived: before payment nobody in the kitchen has anything to do, and after payment
/// the order is waiting on the restaurant to accept it. Only the second one has a customer sitting
/// there having already paid, so it is the one that needs a clock on it.
///
/// <para>
/// The thresholds live here so the staff screens, the customer's cancellation rights and the
/// platform's reporting all measure the same thing.
/// </para>
/// </summary>
public static class OrderAcceptancePolicy
{
    /// <summary>Long enough to be a normal rush, short enough to still be recoverable.</summary>
    public static readonly TimeSpan WarningAfter = TimeSpan.FromMinutes(5);

    /// <summary>Past this the order is treated as overdue and escalated on screen and audibly.</summary>
    public static readonly TimeSpan OverdueAfter = TimeSpan.FromMinutes(10);

    /// <summary>
    /// When a customer may take the decision back into their own hands and cancel for a refund.
    /// Deliberately later than the staff escalations: the restaurant gets two chances to notice
    /// before the customer is offered their money back.
    /// </summary>
    public static readonly TimeSpan CustomerCancellationAfter = TimeSpan.FromMinutes(20);

    /// <summary>Settled money on an order the restaurant has not accepted yet.</summary>
    public static bool IsAwaitingAcceptance(OrderStatus orderStatus, PaymentStatus paymentStatus) =>
        orderStatus == OrderStatus.Pending && IsSettled(paymentStatus);

    /// <summary>
    /// How long the paid order has been waiting. Measured from when the payment settled, falling
    /// back to when the order was raised — an order that somehow has no settlement timestamp
    /// should still age rather than look permanently new.
    /// </summary>
    public static TimeSpan WaitedForAcceptance(DateTime? paidAtUtc, DateTime createdAtUtc, DateTime nowUtc)
    {
        var since = paidAtUtc ?? createdAtUtc;
        var waited = nowUtc - since;
        return waited < TimeSpan.Zero ? TimeSpan.Zero : waited;
    }

    public static bool IsOverdue(TimeSpan waited) => waited >= OverdueAfter;

    public static bool IsApproaching(TimeSpan waited) => waited >= WarningAfter && waited < OverdueAfter;

    /// <summary>
    /// Whether the customer may cancel a paid order themselves and be refunded. Online only: a
    /// counter payment is settled face to face and has no automated refund path.
    /// </summary>
    public static bool CanCustomerCancelForRefund(
        OrderStatus orderStatus,
        PaymentStatus paymentStatus,
        PaymentMethod paymentMethod,
        DateTime? paidAtUtc,
        DateTime createdAtUtc,
        DateTime nowUtc) =>
        paymentMethod == PaymentMethod.Online
        && IsAwaitingAcceptance(orderStatus, paymentStatus)
        && WaitedForAcceptance(paidAtUtc, createdAtUtc, nowUtc) >= CustomerCancellationAfter;

    private static bool IsSettled(PaymentStatus paymentStatus) =>
        paymentStatus is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded;
}
