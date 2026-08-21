using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// Whether turning an order away owes the customer their money back, and how much.
/// </summary>
/// <remarks>
/// <para>
/// Rejecting a paid order and refunding it were two separate things a member of staff had to
/// remember to do, and the second one is the one nobody remembers: every paid order rejected on this
/// deployment had been rejected and not refunded. The customer is left with money gone, no food, and
/// an order marked Rejected.
/// </para>
/// <para>
/// The rule this restores is one the codebase already holds elsewhere. A restaurant that closes
/// without accepting an order has its orders refunded automatically, on the reasoning that "nobody
/// is coming to accept it, so holding the customer's money serves no one". Staff pressing reject is
/// that same situation stated out loud, and was the one case where the money stayed.
/// </para>
/// </remarks>
public static class TurnedAwayOrderRefund
{
    /// <summary>Payment states that mean money was taken and has not all come back.</summary>
    private static bool HoldsCustomerMoney(PaymentStatus status) =>
        status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded;

    /// <summary>
    /// What is still owed back on an order the restaurant has turned away, or null when nothing is.
    /// </summary>
    /// <param name="order">The order, with its payments and their refunds loaded.</param>
    /// <param name="closedByCustomer">
    /// True when the customer ended it themselves — their own cancellation has its own policy and
    /// must not be re-decided here.
    /// </param>
    public static long? AmountOwedCents(Order order, bool closedByCustomer)
    {
        if (closedByCustomer || !HoldsCustomerMoney(order.PaymentStatus))
        {
            return null;
        }

        // Counter payments are settled in cash at the till, so there is nothing for the platform to
        // send back — the restaurant hands it over, or never took it.
        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return null;
        }

        var owed = order.Payments
            .Where(payment => payment.Status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded)
            .Sum(payment => payment.AmountCents - payment.Refunds
                .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                .Sum(refund => refund.AmountCents));

        return owed > 0 ? owed : null;
    }

    /// <summary>
    /// The wording the customer sees. Deliberately not the staff member's own note: that is an
    /// internal record, and "duplicate order" on a bank statement explains nothing to the person
    /// reading it.
    /// </summary>
    public static string CustomerExplanation(OrderStatus closedAs) =>
        closedAs == OrderStatus.Rejected
            ? "The restaurant could not accept this order, so it has been refunded in full."
            : "The restaurant cancelled this order, so it has been refunded in full.";
}
