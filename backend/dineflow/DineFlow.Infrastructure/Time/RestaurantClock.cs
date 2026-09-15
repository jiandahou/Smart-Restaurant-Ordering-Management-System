namespace DineFlow.Infrastructure.Time;

/// <summary>
/// Converting between UTC and a restaurant's own wall clock.
/// </summary>
/// <remarks>
/// Extracted from the opening-hours service so that billing can ask the same questions and get the
/// same answers. Two implementations of "what time is it there" is two chances to disagree about
/// when a day ends, and the second one is always the one written in a hurry.
/// </remarks>
public static class RestaurantClock
{
    /// <summary>
    /// The restaurant's time zone, falling back to UTC rather than throwing.
    /// </summary>
    /// <remarks>
    /// A restaurant whose time zone was typed wrong should show slightly wrong opening hours, not
    /// fail every request that touches it.
    /// </remarks>
    public static TimeZoneInfo Resolve(string timezone)
    {
        if (TimeZoneInfo.TryConvertIanaIdToWindowsId(timezone, out var windowsTimeZone))
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(windowsTimeZone);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timezone);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    public static DateTime ToLocal(DateTime utc, string timezone) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), Resolve(timezone));

    /// <summary>
    /// The UTC instant of a wall-clock time in this restaurant's zone.
    /// </summary>
    /// <remarks>
    /// A spring-forward can make a wall-clock time not exist at all — 02:30 simply never happens on
    /// the day the clocks go forward. Nudging past the gap is better than throwing at the caller,
    /// who asked a perfectly reasonable question about a time that a calendar says is real.
    /// </remarks>
    public static DateTime ToUtc(DateTime local, string timezone)
    {
        var timeZoneInfo = Resolve(timezone);
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);

        if (timeZoneInfo.IsInvalidTime(unspecified))
        {
            unspecified = unspecified.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(unspecified, timeZoneInfo);
    }

    /// <summary>
    /// The first time the restaurant's clock reads <paramref name="hour"/> at or after
    /// <paramref name="notBefore"/>.
    /// </summary>
    public static DateTime NextLocalHourAtOrAfter(DateTime notBefore, string timezone, int hour)
    {
        var local = ToLocal(notBefore, timezone);
        var candidate = local.Date.AddHours(hour);

        if (candidate < local)
        {
            candidate = candidate.AddDays(1);
        }

        return ToUtc(candidate, timezone);
    }
}
