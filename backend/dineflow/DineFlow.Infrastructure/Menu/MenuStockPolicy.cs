namespace DineFlow.Infrastructure.Menu;

/// <summary>
/// The range a tracked stock count may hold, and what an adjustment may do to it.
/// </summary>
/// <remarks>
/// <para>
/// The count had a floor and no ceiling. Adjustments are applied by the database in one statement,
/// deliberately — reading the count and writing it back loses an increment whenever two people
/// press the button at once — but that statement was <c>StockQuantity + delta</c> on an
/// <c>integer</c> column, so a count at <see cref="int.MaxValue"/> adjusted by one raised
/// PostgreSQL 22003 and the caller got a 500.
/// </para>
/// <para>
/// The fix is a ceiling rather than wider arithmetic. Portions of a dish are a small number by
/// nature; a kitchen that has typed a million of something has made a mistake worth stopping, and
/// no real one is served by letting the count run to two billion. With both the count and the
/// adjustment held inside this range, the sum the database computes cannot leave it, so the single
/// atomic statement stays exactly as it was.
/// </para>
/// </remarks>
public static class MenuStockPolicy
{
    /// <summary>The most portions of one item a kitchen may claim to have.</summary>
    public const int MaximumStockQuantity = 1_000_000;

    /// <summary>True when an absolute count is one the column may hold.</summary>
    public static bool IsValidQuantity(int quantity) =>
        quantity >= 0 && quantity <= MaximumStockQuantity;

    /// <summary>
    /// True when a single adjustment is plausible on its own terms. A step larger than the whole
    /// permitted range is a typo whatever the current count happens to be.
    /// </summary>
    public static bool IsValidAdjustment(int delta) =>
        delta >= -MaximumStockQuantity && delta <= MaximumStockQuantity;

    /// <summary>
    /// Where <paramref name="current"/> lands after <paramref name="delta"/>, held inside the range.
    /// Computed in <see cref="long"/> so the check itself cannot overflow.
    /// </summary>
    public static int Apply(int current, int delta) =>
        (int)Math.Clamp((long)current + delta, 0L, MaximumStockQuantity);

    /// <summary>
    /// True when the adjustment would push the count past the ceiling. Running out is ordinary and
    /// clamps to zero; running past the top is not, and is refused rather than quietly capped, so
    /// the operator finds out their number did not mean what they typed.
    /// </summary>
    public static bool WouldExceedMaximum(int current, int delta) =>
        (long)current + delta > MaximumStockQuantity;
}
