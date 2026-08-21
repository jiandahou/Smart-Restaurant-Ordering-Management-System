using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// When an order that was placed but never paid for stops holding the restaurant's stock.
/// </summary>
/// <remarks>
/// <para>
/// Checking out reserves stock and takes a pickup number, before any money changes hands. That is
/// the right way round — reserving at payment time would let two people pay for the last portion —
/// but a reservation with no expiry is a leak. A customer who reaches the payment screen and simply
/// leaves used to hold those portions permanently: nothing released them, because releasing only
/// happened when somebody cancelled, and the person who walked away is by definition not coming
/// back to cancel. Repeat it a few times and the dish reads as sold out with nothing sold.
/// </para>
/// <para>
/// So the reservation expires, the way a held seat or a held hotel room expires.
/// </para>
/// </remarks>
public static class AbandonedOrderPolicy
{
    /// <summary>
    /// How long an unpaid order holds its stock before it is released.
    /// </summary>
    /// <remarks>
    /// Long enough to find a card, ask someone at the table, or lose signal for a while, and it is
    /// also what the customer is told when they come back to a cart with an unpaid order waiting.
    /// </remarks>
    public static readonly TimeSpan ExpiresAfter = TimeSpan.FromMinutes(20);

    /// <summary>
    /// Payment states that mean no attempt is in flight, so the order really is just sitting there.
    /// </summary>
    /// <remarks>
    /// <see cref="PaymentStatus.Pending"/> is deliberately absent: it means a checkout session is
    /// live and the customer may be on the card form right now. Expiring that would cancel an order
    /// out from under somebody in the middle of paying for it.
    /// </remarks>
    public static bool HasNoPaymentInFlight(PaymentStatus paymentStatus) =>
        paymentStatus is PaymentStatus.Unpaid
            or PaymentStatus.Failed
            or PaymentStatus.Expired
            or PaymentStatus.Cancelled;

    /// <summary>
    /// Whether the order is one this policy governs at all.
    /// </summary>
    /// <remarks>
    /// Counter orders are not abandoned, they are promised: the customer has said they will settle
    /// at the till, and the kitchen may already be cooking. They sit Unpaid by design and would
    /// otherwise look exactly like somebody who walked away from the payment screen — so a diner
    /// waiting for their meal would have the order cancelled out from under them, twenty minutes
    /// in, with the stock handed back while the food was on the pass.
    /// </remarks>
    public static bool IsGovernedBy(PaymentMethod paymentMethod) =>
        paymentMethod != PaymentMethod.PayAtCounter;

    /// <summary>Whether an order has been left unpaid long enough to release what it is holding.</summary>
    public static bool HasExpired(
        OrderStatus orderStatus,
        PaymentStatus paymentStatus,
        PaymentMethod paymentMethod,
        DateTime createdAt,
        DateTime utcNow) =>
        orderStatus == OrderStatus.Pending &&
        IsGovernedBy(paymentMethod) &&
        HasNoPaymentInFlight(paymentStatus) &&
        createdAt <= utcNow - ExpiresAfter;

    /// <summary>
    /// When an unpaid order will expire, for telling the customer how long they have left.
    /// </summary>
    public static DateTime ExpiresAt(DateTime createdAt) => createdAt + ExpiresAfter;
}
