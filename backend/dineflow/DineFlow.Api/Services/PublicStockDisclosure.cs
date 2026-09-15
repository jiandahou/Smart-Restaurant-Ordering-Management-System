namespace DineFlow.Api.Services;

/// <summary>
/// How much of a dish's remaining stock a customer is told about.
/// </summary>
/// <remarks>
/// <para>
/// A dish with one portion left used to look exactly like one with unlimited supply: the public
/// menu carried only a sold-out flag. So a customer could put two of the last one in their cart,
/// pick options, and only be turned away at checkout, with nothing having warned them.
/// </para>
/// <para>
/// Every limited dish now publishes its count, not only the nearly-gone ones. That does tell the
/// world how much the kitchen holds, and over a day roughly how much it sells; the restaurant has
/// decided that being straight with people is worth more than keeping the number quiet. Which
/// counts read as urgent is a question for the menu to answer visually, not for this to decide by
/// withholding.
/// </para>
/// <para>
/// Dishes with no count at all are unlimited and say nothing: there is no shortage to warn about,
/// and a badge on every dish would mean nothing.
/// </para>
/// </remarks>
public static class PublicStockDisclosure
{
    /// <summary>
    /// At or below this many portions the menu treats the count as urgent. Published so the browser
    /// and the kitchen's own screens agree on what "low" means.
    /// </summary>
    public const int LowStockAtOrBelow = 5;

    /// <summary>
    /// What to publish as the remaining count, or null to say nothing.
    /// </summary>
    /// <param name="stockQuantity">The tracked count, or null when the dish is not limited.</param>
    /// <param name="isSoldOut">
    /// Whether the dish is stopped. A stopped dish shows as sold out on its own, and a count beside
    /// that would contradict it — a kitchen that has stopped serving a dish still has portions.
    /// </param>
    public static int? RemainingToPublish(int? stockQuantity, bool isSoldOut)
    {
        if (isSoldOut || stockQuantity is null)
        {
            return null;
        }

        var remaining = stockQuantity.Value;

        return remaining > 0 ? remaining : null;
    }
}
