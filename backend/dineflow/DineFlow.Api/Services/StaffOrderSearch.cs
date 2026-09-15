using System.Linq.Expressions;
using DineFlow.Infrastructure.Orders;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// What the staff order search looks at.
/// </summary>
/// <remarks>
/// <para>
/// The box says "Order, pickup, customer, table, or item", and the query looked at everything on that
/// list except the customer. Searching "Customer One" returned nothing while seven of that
/// restaurant's orders were theirs — an answer no different from "they have never ordered here",
/// which is what staff would reasonably have concluded.
/// </para>
/// <para>
/// Stated here rather than inside the controller so the fields searched are the ones a test can check,
/// instead of a second copy that agrees with the real query only until someone edits one of them.
/// </para>
/// </remarks>
public static class StaffOrderSearch
{
    /// <summary>
    /// Orders matching what someone typed, within whatever the caller has already scoped the query to.
    /// </summary>
    /// <remarks>
    /// This adds no scope of its own. Restaurant scoping is applied before it, so a name typed here
    /// can only ever reach the caller's own orders — searching is not a way to look into another
    /// restaurant's book.
    /// </remarks>
    public static Expression<Func<Order, bool>> Predicate(string search)
    {
        // The wildcards belong to LIKE, not to whoever is typing.
        var pattern = SearchPattern.Contains(search);
        var hasPickupNumber = int.TryParse(search.TrimStart('#'), out var pickupNumber);

        return order =>
            EF.Functions.ILike(order.OrderNumber, pattern, SearchPattern.EscapeCharacter)
            || (hasPickupNumber && order.PickupNumber == pickupNumber)
            || (order.Table != null &&
                EF.Functions.ILike(order.Table.TableNumber, pattern, SearchPattern.EscapeCharacter))
            // Staff are shown the customer's name and email on every order on this screen, so
            // searching them puts nothing in front of anyone that was not already there.
            || (order.Customer != null && order.Customer.FullName != null &&
                EF.Functions.ILike(order.Customer.FullName, pattern, SearchPattern.EscapeCharacter))
            || (order.Customer != null && order.Customer.Email != null &&
                EF.Functions.ILike(order.Customer.Email, pattern, SearchPattern.EscapeCharacter))
            || order.OrderItems.Any(item =>
                EF.Functions.ILike(item.MenuItemNameSnapshot, pattern, SearchPattern.EscapeCharacter));
    }
}
