namespace DineFlow.Api.Services;

/// <summary>
/// Whether a cart may hold this many of a limited dish.
/// </summary>
/// <remarks>
/// <para>
/// Stock is reserved at checkout, not here — holding portions for every cart would let an abandoned
/// cart starve the menu. So this is a warning, not a reservation: it tells a customer now what they
/// would otherwise only discover after choosing every option and pressing pay. Two customers can
/// still both pass this check for the same last portion, and one of them will lose at checkout.
/// That race is unavoidable without reserving, and losing it at checkout is far better than filling
/// a cart in ignorance.
/// </para>
/// <para>
/// The whole cart counts, not just the line being added. Adding "one more" to a cart that already
/// holds the last portion is still asking for two.
/// </para>
/// </remarks>
public readonly record struct CartStockLimit(bool IsAllowed, int? Remaining, int AlreadyInCart)
{
    /// <summary>
    /// Checks a requested quantity against what is left.
    /// </summary>
    /// <param name="stockQuantity">Tracked portions, or null when the dish is not limited.</param>
    /// <param name="alreadyInCart">How many of this dish the cart already holds, across all lines.</param>
    /// <param name="requested">How many more are being added.</param>
    public static CartStockLimit Evaluate(int? stockQuantity, int alreadyInCart, int requested)
    {
        if (stockQuantity is null)
        {
            // Not limited: there is nothing to run out of.
            return new CartStockLimit(true, null, alreadyInCart);
        }

        var remaining = Math.Max(0, stockQuantity.Value);
        var wanted = alreadyInCart + Math.Max(0, requested);

        return new CartStockLimit(wanted <= remaining, remaining, alreadyInCart);
    }

    /// <summary>A sentence a customer can act on, naming the dish and what is actually available.</summary>
    public string DescribeRefusal(string dishName)
    {
        var left = Remaining ?? 0;

        if (left == 0)
        {
            return $"{dishName} has just sold out.";
        }

        var portions = left == 1 ? "1 portion" : $"{left} portions";

        return AlreadyInCart > 0
            ? $"Only {portions} of {dishName} left, and your cart already has {AlreadyInCart}."
            : $"Only {portions} of {dishName} left.";
    }
}
