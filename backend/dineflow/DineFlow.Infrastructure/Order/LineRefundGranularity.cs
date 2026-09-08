namespace DineFlow.Infrastructure.Orders;

/// <summary>How a line has been refunded so far, which fixes how it may be refunded next.</summary>
public enum LineRefundGranularity
{
    /// <summary>Nothing refunded yet. Either way is still open.</summary>
    Untouched,

    /// <summary>Refunded as a line. Its modifiers may no longer be refunded by name.</summary>
    AsAWhole,

    /// <summary>Refunded modifier by modifier. The line may no longer be refunded as a whole.</summary>
    ByItsParts,
}

/// <summary>
/// A line is refunded as a whole or by its parts, never both.
/// </summary>
/// <remarks>
/// <para>
/// The two ways of refunding a line do not see each other. A modifier-tagged refund spends both the
/// modifier's balance and the line's; a line-level refund spends only the line's, because it names
/// no modifier and cannot say which balances it consumed. That asymmetry is a way to pay twice for
/// one thing: refund a line for an amount that morally covered the truffle, then refund the truffle
/// by name — its own balance was never touched, the line may still have room, and the truffle goes
/// back to the customer a second time.
/// </para>
/// <para>
/// The alternative to this rule is deciding how much of a line-level refund each modifier absorbed,
/// which is a split nobody chose being written into the ledger and then governing every later
/// refund. That is the fault the per-item approval was written to remove; it should not be
/// reintroduced one layer down.
/// </para>
/// <para>
/// So the first refund on a line settles the grain, and the rest follow it. One sentence, one query
/// to enforce, and the line's remaining amount is always exactly what its parts still hold.
/// </para>
/// </remarks>
public static class LineRefundGranularityPolicy
{
    /// <summary>
    /// What the refunds already recorded against a line have settled.
    /// </summary>
    /// <param name="taggedWithAModifier">
    /// For each succeeded refund allocation on the line, whether it named a modifier.
    /// </param>
    public static LineRefundGranularity Settled(IEnumerable<bool> taggedWithAModifier)
    {
        var granularity = LineRefundGranularity.Untouched;

        foreach (var tagged in taggedWithAModifier)
        {
            // A line carrying both already exists only if this rule was not in force when it was
            // refunded. Reporting the coarser grain keeps it from being split further now.
            if (!tagged)
            {
                return LineRefundGranularity.AsAWhole;
            }

            granularity = LineRefundGranularity.ByItsParts;
        }

        return granularity;
    }

    public static bool AllowsWholeLineRefund(LineRefundGranularity settled) =>
        settled is LineRefundGranularity.Untouched or LineRefundGranularity.AsAWhole;

    public static bool AllowsModifierRefund(LineRefundGranularity settled) =>
        settled is LineRefundGranularity.Untouched or LineRefundGranularity.ByItsParts;

    /// <summary>
    /// Whether one request asks for a line both ways at once.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <see cref="Settled"/> reads refunds that have already succeeded, so it cannot see the
    /// request being written. Within a single request the dish and one of its extras are two
    /// selections that each pass their own balance check — the line against the line's, the extra
    /// against the extra's — and neither knows about the other. Granted together they return the
    /// line's full value plus the extra's share of it, which is the same money twice.
    /// </para>
    /// <para>
    /// So the rule applies to a request's own contents as well as to its history.
    /// </para>
    /// </remarks>
    /// <param name="selections">Whether each selection on this line named an extra.</param>
    public static bool AsksForALineBothWays(IEnumerable<bool> selections)
    {
        var namedAnExtra = false;
        var namedTheLine = false;

        foreach (var tagged in selections)
        {
            if (tagged)
            {
                namedAnExtra = true;
            }
            else
            {
                namedTheLine = true;
            }

            if (namedAnExtra && namedTheLine)
            {
                return true;
            }
        }

        return false;
    }

    public static string ExplainAskedBothWays(string menuItemName) =>
        $"Ask for \"{menuItemName}\" itself or for its extras, not both in one request.";

    public static string ExplainWholeLineRefused(string menuItemName) =>
        $"Extras on \"{menuItemName}\" have already been refunded individually, so it can only be "
        + "refunded extra by extra from here.";

    public static string ExplainModifierRefused(string menuItemName) =>
        $"\"{menuItemName}\" has already been refunded as a whole item, so its extras cannot be "
        + "refunded separately.";
}
