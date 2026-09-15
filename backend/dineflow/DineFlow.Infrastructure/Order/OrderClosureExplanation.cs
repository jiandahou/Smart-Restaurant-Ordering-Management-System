namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// The entry in an order's history that explains why it ended.
/// </summary>
/// <remarks>
/// <para>
/// Staff choose a reason when they turn an order away, and it was written to the history and left
/// there: the customer's own view showed the order as Rejected with nothing beside it. That is the
/// moment the reason matters most — whether to order again without that dish, or not to bother.
/// </para>
/// <para>
/// The last transition into a closed state is the one that answers the question. An order can pass
/// through several transitions, and an earlier one — accepted, then started — says nothing about why
/// it finished the way it did.
/// </para>
/// </remarks>
public static class OrderClosureExplanation
{
    /// <summary>The transition that closed this order, or null while it is still open.</summary>
    public static OrderStatusHistory? Find(Order order)
    {
        if (order.Status is not (OrderStatus.Cancelled or OrderStatus.Rejected))
        {
            return null;
        }

        return order.StatusHistory
            .Where(entry => entry.NewStatus == order.Status)
            .OrderByDescending(entry => entry.CreatedAt)
            .FirstOrDefault();
    }

    /// <summary>
    /// Whether the customer ended this order themselves, so the page can say "you cancelled this"
    /// rather than attributing their own decision to the restaurant.
    /// </summary>
    public static bool EndedByCustomer(Order order, OrderStatusHistory closure) =>
        !string.IsNullOrWhiteSpace(order.CustomerId)
            ? string.Equals(closure.ChangedByUserId, order.CustomerId, StringComparison.Ordinal)
            // A guest has no user id to compare, so the actor is the only signal: staff transitions
            // are always attributed, and a guest cancelling their own order is not.
            : string.IsNullOrWhiteSpace(closure.ChangedByUserId);
}
