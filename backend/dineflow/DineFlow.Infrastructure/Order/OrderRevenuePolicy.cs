using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// What an order contributed to a day's takings.
/// </summary>
/// <remarks>
/// <para>
/// Both the count and the revenue tested for <see cref="PaymentStatus.Paid"/> exactly, so an order
/// left them entirely the moment any money went back: refunding one dollar of a twenty-six dollar
/// order removed the whole twenty-six from the day. The order had not stopped being paid for — part
/// of it had been returned, which is a different thing and a much smaller number.
/// </para>
/// <para>
/// The rule: money that completed counts, net of what was returned. A fully refunded order still
/// counts as having happened and contributes nothing, rather than disappearing from the record.
/// Everything else contributes nothing — an order awaiting payment is not takings, and neither is
/// one that will be settled at the till.
/// </para>
/// </remarks>
public static class OrderRevenuePolicy
{
    /// <summary>Payment states in which the customer's money was actually taken.</summary>
    public static bool IsSettled(PaymentStatus status) =>
        status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded or PaymentStatus.Refunded;

    /// <summary>
    /// What was kept from an order, never below zero.
    /// </summary>
    /// <remarks>
    /// A refund larger than the order — over-refunded, or money attributed across several payments —
    /// takes it to zero and no further. No day has negative takings.
    /// </remarks>
    public static decimal NetRevenue(PaymentStatus status, decimal totalAmount, long refundedCents)
    {
        if (!IsSettled(status))
        {
            return 0m;
        }

        var kept = totalAmount - refundedCents / 100m;

        return kept > 0m ? kept : 0m;
    }
}
