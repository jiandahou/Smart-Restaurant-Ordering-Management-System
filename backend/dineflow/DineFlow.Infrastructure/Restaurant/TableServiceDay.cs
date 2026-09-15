using DineFlow.Infrastructure.Time;

namespace DineFlow.Infrastructure.Restaurant;

/// <summary>
/// Which sitting a moment belongs to, so one table's bill cannot outlive the people at it.
/// </summary>
/// <remarks>
/// <para>
/// A table session was reused for as long as it stayed open, and it stayed open only until the
/// front counter settled it. Anything else that ended the last order — a customer cancelling, staff
/// rejecting, an unpaid order timing out — left the session open with nothing in it, and the next
/// person to scan that QR code months later joined it. Where the earlier sitting had left an order
/// unresolved, they joined that too: their one plate of garlic bread appeared as a line on somebody
/// else's dinner, and the till read the total as one party's.
/// </para>
/// <para>
/// So a sitting is bounded by time as well as by settlement, and the boundary is a closing hour
/// rather than midnight. A table seated at half past eleven that orders again after twelve is one
/// dinner, and splitting it in two would be wrong in a way the customer would notice immediately.
/// Four in the morning is the same hour the platform holds suspensions to, for the same reason: it
/// is the time of day when a restaurant is least likely to have anybody sitting down.
/// </para>
/// </remarks>
public static class TableServiceDay
{
    /// <summary>
    /// The hour, on the restaurant's own clock, at which one service day gives way to the next.
    /// </summary>
    /// <remarks>
    /// Deliberately a constant rather than a per-restaurant setting. It exists to stop a bill from
    /// running for a month, and any hour in the small morning does that; making it configurable
    /// would ask every restaurant to answer a question they have no reason to think about, and the
    /// first wrong answer would be a table that splits mid-dinner.
    /// </remarks>
    public const int ClosingHourLocal = 4;

    /// <summary>The service day a moment falls in, on the restaurant's own clock.</summary>
    /// <remarks>
    /// Named by the day it started: everything from 04:00 on the 9th up to 03:59 on the 10th is the
    /// 9th's service, which is how the people working it would name it too.
    /// </remarks>
    public static DateOnly For(DateTime utc, string timezone) =>
        DateOnly.FromDateTime(RestaurantClock.ToLocal(utc, timezone).AddHours(-ClosingHourLocal));

    /// <summary>Whether a session opened then is still the same sitting now.</summary>
    public static bool IsSameService(DateTime openedAtUtc, DateTime utcNow, string timezone) =>
        For(openedAtUtc, timezone) == For(utcNow, timezone);
}
