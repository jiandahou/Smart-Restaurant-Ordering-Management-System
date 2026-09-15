using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// Whether refunding an order in full should also close it.
/// </summary>
/// <remarks>
/// <para>
/// Money and food have to agree. An order that has been refunded in full but still reads as Accepted
/// tells the kitchen to cook it and the customer that they have been paid back — and the kitchen has
/// no way to see the contradiction, because the refund lives on a different screen.
/// </para>
/// <para>
/// The dividing line is whether anything has been handed over. Nothing has left the pass while an
/// order is pending, accepted or being prepared, so refunding it in full means it is off, and the
/// order is closed to say so. Once it is ready or completed the food exists and may already have
/// been eaten: a full refund there is redress after the fact, and rewriting the order as cancelled
/// would be recording something that did not happen — the kitchen's own history and every report
/// built on it would then disagree with the day it actually had.
/// </para>
/// <para>
/// This decides only the consequence. The refund is its own recorded action, with its own amount,
/// audit trail and provider reference; a status change must never be the thing that moves money,
/// or an accidental cancellation becomes an accidental payout.
/// </para>
/// </remarks>
public static class RefundedOrderClosure
{
    /// <summary>Statuses in which nothing has been handed to the customer yet.</summary>
    private static bool NothingHandedOver(OrderStatus status) =>
        status is OrderStatus.Pending or OrderStatus.Accepted or OrderStatus.Preparing;

    /// <summary>
    /// Whether this refund leaves nothing owing, so the order has been paid back in full.
    /// </summary>
    /// <param name="paidCents">What the customer paid.</param>
    /// <param name="refundedCents">What has gone back, including this refund.</param>
    public static bool IsFullyRefunded(long paidCents, long refundedCents) =>
        paidCents > 0 && refundedCents >= paidCents;

    /// <summary>
    /// Whether the order should be closed as a result, or null when it should be left as it is.
    /// </summary>
    public static OrderStatus? ClosureFor(OrderStatus current, long paidCents, long refundedCents)
    {
        if (!IsFullyRefunded(paidCents, refundedCents) || !NothingHandedOver(current))
        {
            return null;
        }

        return OrderStatus.Cancelled;
    }

    /// <summary>The wording the customer reads, which is not the staff member's internal note.</summary>
    public const string CustomerExplanation =
        "This order was refunded in full, so it will not be prepared.";

    /// <summary>Whether an order in this payment state has money that could come back.</summary>
    public static bool HoldsMoney(PaymentStatus status) =>
        status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded;
}
