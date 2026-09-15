using DineFlow.Infrastructure.Menu;

namespace DineFlow.Api.Services;

/// <summary>
/// Whether a cart line can still be ordered, and if not, why.
///
/// <para>
/// Reading a cart and checking one out used to answer this question differently. The cart snapshot
/// looked at two things — is the dish visible, is it sold out — and reported them as separate flags
/// with no verdict between them. Checkout looked at six, adding the dish's restaurant and the state
/// of its category. So a line whose category had been archived came back from a read as perfectly
/// fine and was refused at the till, and a sold-out line came back with <c>isAvailable: true</c>
/// beside <c>isSoldOut: true</c> — technically both true, and useless to anyone reading the first
/// one to decide whether the order would go through.
/// </para>
///
/// <para>
/// One rule, asked in both places, so the cart cannot promise something the till will refuse. The
/// reason travels with the verdict because "this item is unavailable" does not tell a customer
/// whether to wait, choose something else, or ask a member of staff.
/// </para>
/// </summary>
/// <param name="IsOrderable">True when checkout would accept this line as it stands.</param>
/// <param name="Reason">Customer-facing explanation, or null when the line is fine.</param>
public readonly record struct CartLineAvailability(bool IsOrderable, string? Reason)
{
    private static readonly CartLineAvailability Orderable = new(true, null);

    /// <summary>
    /// Judges one line against the menu as it stands now.
    /// </summary>
    /// <param name="menuItem">
    /// The dish, with its category loaded. A null category is treated as missing rather than
    /// harmless — the caller not loading it is exactly how this check gets silently skipped.
    /// </param>
    /// <param name="cartRestaurantId">The restaurant the cart belongs to.</param>
    public static CartLineAvailability Evaluate(MenuItem? menuItem, Guid cartRestaurantId)
    {
        if (menuItem is null || menuItem.RestaurantId != cartRestaurantId)
        {
            return new CartLineAvailability(false, "This item is no longer on this restaurant's menu.");
        }

        if (menuItem.Category is null ||
            menuItem.Category.RestaurantId != cartRestaurantId ||
            !menuItem.Category.IsActive)
        {
            return new CartLineAvailability(false, "This item's menu section is no longer being served.");
        }

        if (!menuItem.IsAvailable)
        {
            return new CartLineAvailability(false, "The restaurant has taken this item off the menu.");
        }

        if (menuItem.IsSoldOut)
        {
            return new CartLineAvailability(false, "This item has sold out.");
        }

        return Orderable;
    }
}
