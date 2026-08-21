using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// Whether an order may still be sent to an online checkout.
/// </summary>
/// <remarks>
/// <para>
/// The rule this settles: <b>a finished order is not paid online.</b> Completed orders were left out
/// of the refusals, so several Completed-and-unpaid orders were offered a Checkout button in Admin
/// Payments and could be charged through to a real Stripe session.
/// </para>
/// <para>
/// That is the wrong shape of answer to the problem it looks like it solves. Completed means the food
/// was handed over and the customer has gone; a payment link nobody is standing at is not a recovery,
/// it is a charge against a closed transaction with no one watching how it turns out. And an order
/// that is completed while still owing money is not a routine unpaid bill — it is a bookkeeping
/// incident, either a till that failed to record cash or food that went out unpaid. It wants a person,
/// not a payment page.
/// </para>
/// <para>
/// Nobody is stranded by this. Money still owed on a completed order is recorded at the counter,
/// which writes a payment and is audited; an online order can be switched to counter payment first;
/// and an order can be reopened deliberately. All three leave a trace with a name on it, which a
/// quietly minted checkout session does not.
/// </para>
/// </remarks>
public static class OnlineCheckoutEligibility
{
    /// <summary>Why an online checkout was refused, or null when it is allowed.</summary>
    public static string? Refuse(OrderStatus status, PaymentStatus paymentStatus, PaymentMethod paymentMethod)
    {
        if (OrderPaymentEligibility.IsSettledForFulfillment(paymentStatus)
            || paymentStatus == PaymentStatus.Refunded)
        {
            return "This order cannot be paid online.";
        }

        if (paymentMethod != PaymentMethod.Online)
        {
            return "This order is configured for payment at the counter.";
        }

        if (status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return "Cancelled or rejected orders cannot be paid.";
        }

        if (status == OrderStatus.Completed)
        {
            return "This order has already been completed. Money still owed on it is recorded at the "
                + "counter, or the order is reopened first — a completed order is not paid online.";
        }

        return null;
    }

    /// <summary>Whether an order is one someone could still be asked to pay online.</summary>
    public static bool IsPayableOnline(OrderStatus status, PaymentStatus paymentStatus, PaymentMethod paymentMethod) =>
        Refuse(status, paymentStatus, paymentMethod) is null;

    /// <summary>Order states that no longer take an online payment, whatever is owed.</summary>
    public static readonly OrderStatus[] ClosedToOnlinePayment =
    [
        OrderStatus.Completed,
        OrderStatus.Cancelled,
        OrderStatus.Rejected
    ];
}
