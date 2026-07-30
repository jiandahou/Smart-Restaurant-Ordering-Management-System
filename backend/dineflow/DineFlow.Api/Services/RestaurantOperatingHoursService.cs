using System.Globalization;
using System.Text.Json;
using DineFlow.Infrastructure.Restaurant;

namespace DineFlow.Api.Services;

public sealed class RestaurantOperatingHoursService
{
    /// <summary>How far ahead to look for the next open/close flip. Covers a week of closures.</summary>
    private const int TransitionLookaheadDays = 14;

    public const string DefaultOpeningHoursJson =
        "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// A timed pause lapses on its own, so the stored flag alone is not the answer — callers must
    /// use this rather than reading <see cref="Restaurant.AcceptingOrders"/> directly.
    /// </summary>
    public static bool IsAcceptingOrders(Restaurant restaurant, DateTime? utcNow = null)
    {
        if (restaurant.AcceptingOrders)
        {
            return true;
        }

        return restaurant.AcceptingOrdersPausedUntil.HasValue &&
            restaurant.AcceptingOrdersPausedUntil.Value <= (utcNow ?? DateTime.UtcNow);
    }

    /// <summary>The restaurant's own wall clock, which is the only clock its schedule is written in.</summary>
    public static DateTime GetLocalNow(Restaurant restaurant, DateTime? utcNow = null) =>
        ConvertToRestaurantTime(utcNow ?? DateTime.UtcNow, restaurant.Timezone);

    public RestaurantOrderingAvailability GetAvailability(Restaurant restaurant, DateTime? utcNow = null) =>
        GetAvailability(
            restaurant.IsActive,
            restaurant.AcceptingOrders,
            restaurant.AcceptingOrdersPausedUntil,
            restaurant.Timezone,
            restaurant.OpeningHoursJson,
            restaurant.SpecialOpeningDaysJson,
            utcNow);

    /// <summary>
    /// Field-based overload for call sites that only have a projection (for example the paged list
    /// endpoint) rather than a tracked entity.
    /// </summary>
    public RestaurantOrderingAvailability GetAvailability(
        bool isActive,
        bool acceptingOrdersFlag,
        DateTime? pausedUntilUtc,
        string timezone,
        string openingHoursJson,
        string specialOpeningDaysJson,
        DateTime? utcNow = null)
    {
        var now = utcNow ?? DateTime.UtcNow;
        var acceptingOrders = acceptingOrdersFlag ||
            (pausedUntilUtc.HasValue && pausedUntilUtc.Value <= now);

        if (!isActive)
        {
            return new RestaurantOrderingAvailability(
                false,
                false,
                acceptingOrders,
                "Inactive",
                "Restaurant is not available for ordering.",
                null,
                null,
                null);
        }

        var localNow = ConvertToRestaurantTime(now, timezone);
        var openingHours = TryParseOpeningHours(openingHoursJson, out var parsedHours, out _)
            ? parsedHours
            : CreateDefaultOpeningHours();
        var specialOpeningDays = TryParseSpecialOpeningDays(specialOpeningDaysJson, out var parsedSpecialDays, out _)
            ? parsedSpecialDays
            : [];
        var isWithinOpeningHours = IsWithinOpeningHours(openingHours, specialOpeningDays, localNow);
        var (nextTransition, nextOpening) = GetUpcomingMoments(
            openingHours,
            specialOpeningDays,
            localNow,
            isWithinOpeningHours);

        if (!acceptingOrders)
        {
            return new RestaurantOrderingAvailability(
                false,
                isWithinOpeningHours,
                false,
                "Paused",
                pausedUntilUtc.HasValue
                    ? "Restaurant is paused and will resume automatically."
                    : "Restaurant is paused and is not accepting orders right now.",
                nextTransition,
                nextOpening,
                pausedUntilUtc);
        }

        return isWithinOpeningHours
            ? new RestaurantOrderingAvailability(
                true,
                true,
                true,
                "Open",
                "Restaurant is accepting orders.",
                nextTransition,
                nextOpening,
                null)
            : new RestaurantOrderingAvailability(
                false,
                false,
                true,
                "Closed",
                "Restaurant is outside opening hours and is not accepting orders right now.",
                nextTransition,
                nextOpening,
                null);
    }

    /// <summary>
    /// The next open/closed flip and the next opening, in restaurant-local time.
    ///
    /// These differ while trading: the next flip is today's closing time, whereas the next opening
    /// is tomorrow's. Both are null when the lookahead shows no such moment (for example 24/7).
    /// </summary>
    private static (DateTime? NextTransition, DateTime? NextOpening) GetUpcomingMoments(
        IReadOnlyList<RestaurantOpeningHoursDay> openingHours,
        IReadOnlyList<RestaurantSpecialOpeningDay> specialOpeningDays,
        DateTime localNow,
        bool isOpenNow)
    {
        var (intervals, horizonEnd) = BuildOpeningIntervals(openingHours, specialOpeningDays, localNow);

        if (!isOpenNow)
        {
            // While closed the next flip is itself the next opening.
            var upcoming = NextStartAfter(intervals, localNow);
            return (upcoming, upcoming);
        }

        var runEnd = GetContiguousRunEnd(intervals, localNow, horizonEnd);
        return runEnd is null
            ? (null, null)
            : (runEnd, NextStartAfter(intervals, runEnd.Value));
    }

    private static DateTime? NextStartAfter(List<OpeningInterval> intervals, DateTime moment) =>
        intervals
            .Where(interval => interval.Start > moment)
            .Select(interval => (DateTime?)interval.Start)
            .Min();

    /// <summary>
    /// The next time the restaurant opens after <paramref name="utcNow"/>, as a UTC instant. When it
    /// is currently open this skips past the current trading run, so "pause until we next open"
    /// means tomorrow's opening rather than right now. Null when the schedule shows no upcoming
    /// opening within the lookahead.
    /// </summary>
    public DateTime? GetNextOpeningUtc(Restaurant restaurant, DateTime? utcNow = null)
    {
        var localNow = ConvertToRestaurantTime(utcNow ?? DateTime.UtcNow, restaurant.Timezone);
        var openingHours = TryParseOpeningHours(restaurant.OpeningHoursJson, out var parsedHours, out _)
            ? parsedHours
            : CreateDefaultOpeningHours();
        var specialOpeningDays = TryParseSpecialOpeningDays(restaurant.SpecialOpeningDaysJson, out var parsedSpecialDays, out _)
            ? parsedSpecialDays
            : [];

        var isOpenNow = IsWithinOpeningHours(openingHours, specialOpeningDays, localNow);
        var (_, nextOpeningLocal) = GetUpcomingMoments(openingHours, specialOpeningDays, localNow, isOpenNow);

        return nextOpeningLocal is null
            ? null
            : ConvertToUtc(nextOpeningLocal.Value, restaurant.Timezone);
    }

    /// <summary>
    /// Walks to the end of the run of back-to-back windows containing <paramref name="localNow"/>,
    /// so 09:00-14:00 followed by 14:00-21:00 reports one closure at 21:00 rather than two.
    /// Null when not inside a window, or when the run reaches the end of the lookahead.
    /// </summary>
    private static DateTime? GetContiguousRunEnd(
        List<OpeningInterval> intervals,
        DateTime localNow,
        DateTime horizonEnd)
    {
        var runEnd = intervals
            .Where(interval => interval.Start <= localNow && interval.End > localNow)
            .Select(interval => interval.End)
            .DefaultIfEmpty(DateTime.MinValue)
            .Max();

        if (runEnd == DateTime.MinValue)
        {
            return null;
        }

        var extended = true;
        while (extended)
        {
            extended = false;
            foreach (var interval in intervals.Where(interval => interval.Start <= runEnd && interval.End > runEnd))
            {
                runEnd = interval.End;
                extended = true;
            }
        }

        // Running off the end of the lookahead means no closure is visible (for example 24/7),
        // not that the restaurant closes when the horizon happens to stop.
        return runEnd >= horizonEnd ? null : runEnd;
    }

    private static DateTime ConvertToUtc(DateTime localDateTime, string timezone)
    {
        var timeZoneInfo = ResolveTimeZone(timezone);
        var unspecified = DateTime.SpecifyKind(localDateTime, DateTimeKind.Unspecified);

        // A DST spring-forward can make a wall-clock time not exist; nudging past the gap is
        // better than throwing at the caller.
        if (timeZoneInfo.IsInvalidTime(unspecified))
        {
            unspecified = unspecified.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(unspecified, timeZoneInfo);
    }

    private static (List<OpeningInterval> Intervals, DateTime HorizonEnd) BuildOpeningIntervals(
        IReadOnlyList<RestaurantOpeningHoursDay> openingHours,
        IReadOnlyList<RestaurantSpecialOpeningDay> specialOpeningDays,
        DateTime localNow)
    {
        var intervals = new List<OpeningInterval>();
        var startDate = DateOnly.FromDateTime(localNow).AddDays(-1);
        var horizonEnd = startDate.AddDays(TransitionLookaheadDays).ToDateTime(TimeOnly.MinValue).AddDays(1);

        for (var offset = 0; offset <= TransitionLookaheadDays; offset++)
        {
            var date = startDate.AddDays(offset);
            var definition = ResolveOpeningDefinition(date, openingHours, specialOpeningDays);

            if (!definition.IsOpen)
            {
                continue;
            }

            var dayStart = date.ToDateTime(TimeOnly.MinValue);

            foreach (var window in definition.Windows)
            {
                if (IsFullDayWindow(window))
                {
                    intervals.Add(new OpeningInterval(dayStart, dayStart.AddDays(1)));
                    continue;
                }

                var opensAt = ParseTime(window.OpensAt);
                var closesAt = ParseTime(window.ClosesAt);
                var start = dayStart.Add(opensAt.ToTimeSpan());
                var end = dayStart.Add(closesAt.ToTimeSpan());

                if (closesAt <= opensAt)
                {
                    end = end.AddDays(1);
                }

                intervals.Add(new OpeningInterval(start, end));
            }
        }

        return (intervals, horizonEnd);
    }

    public bool TryNormalizeOpeningHoursJson(
        string? openingHoursJson,
        out string normalizedOpeningHoursJson,
        out string? error)
    {
        if (string.IsNullOrWhiteSpace(openingHoursJson))
        {
            normalizedOpeningHoursJson = DefaultOpeningHoursJson;
            error = null;
            return true;
        }

        if (!TryParseOpeningHours(openingHoursJson, out var openingHours, out error))
        {
            normalizedOpeningHoursJson = DefaultOpeningHoursJson;
            return false;
        }

        normalizedOpeningHoursJson = JsonSerializer.Serialize(openingHours, JsonOptions);
        error = null;
        return true;
    }

    public bool TryNormalizeSpecialOpeningDaysJson(
        string? specialOpeningDaysJson,
        out string normalizedSpecialOpeningDaysJson,
        out string? error)
    {
        if (string.IsNullOrWhiteSpace(specialOpeningDaysJson))
        {
            normalizedSpecialOpeningDaysJson = "[]";
            error = null;
            return true;
        }

        if (!TryParseSpecialOpeningDays(specialOpeningDaysJson, out var specialOpeningDays, out error))
        {
            normalizedSpecialOpeningDaysJson = "[]";
            return false;
        }

        normalizedSpecialOpeningDaysJson = JsonSerializer.Serialize(specialOpeningDays, JsonOptions);
        error = null;
        return true;
    }

    private static bool TryParseOpeningHours(
        string openingHoursJson,
        out List<RestaurantOpeningHoursDay> openingHours,
        out string? error)
    {
        List<RestaurantOpeningHoursDayInput>? parsed;

        try
        {
            parsed = JsonSerializer.Deserialize<List<RestaurantOpeningHoursDayInput>>(openingHoursJson, JsonOptions);
        }
        catch (JsonException)
        {
            openingHours = [];
            error = "OpeningHoursJson must be a valid JSON array.";
            return false;
        }

        if (parsed is null || parsed.Count != 7)
        {
            openingHours = [];
            error = "OpeningHoursJson must contain one entry for each day of week 0-6.";
            return false;
        }

        var normalized = new List<RestaurantOpeningHoursDay>(capacity: 7);
        var seenDays = new HashSet<int>();

        foreach (var day in parsed)
        {
            if (day.DayOfWeek is < 0 or > 6 || !seenDays.Add(day.DayOfWeek))
            {
                openingHours = [];
                error = "OpeningHoursJson must contain unique dayOfWeek values from 0 to 6.";
                return false;
            }

            var windows = NormalizeWindows(day);

            if (day.IsOpen && windows.Count == 0)
            {
                openingHours = [];
                error = "Open days must include at least one opening window.";
                return false;
            }

            if (windows.Count > 4)
            {
                openingHours = [];
                error = "Each day can include up to four opening windows.";
                return false;
            }

            foreach (var window in windows)
            {
                if (!IsValidTime(window.OpensAt) || !IsValidTime(window.ClosesAt))
                {
                    openingHours = [];
                    error = "Opening hours times must use HH:mm format.";
                    return false;
                }

                if (string.Equals(window.OpensAt, window.ClosesAt, StringComparison.Ordinal)
                    && !IsFullDayWindow(window))
                {
                    openingHours = [];
                    error = "Opening and closing times cannot be the same, except 00:00 to 00:00 for 24 hours.";
                    return false;
                }
            }

            if (day.IsOpen && HasOverlappingWindows(windows))
            {
                openingHours = [];
                error = "Opening hours windows must not overlap within the same day.";
                return false;
            }

            normalized.Add(new RestaurantOpeningHoursDay
            {
                DayOfWeek = day.DayOfWeek,
                IsOpen = day.IsOpen,
                Windows = windows.Count > 0 ? windows : [CreateDefaultWindow()]
            });
        }

        openingHours = normalized
            .OrderBy(day => day.DayOfWeek)
            .ToList();
        error = null;
        return true;
    }

    private static bool IsWithinOpeningHours(
        IReadOnlyList<RestaurantOpeningHoursDay> openingHours,
        IReadOnlyList<RestaurantSpecialOpeningDay> specialOpeningDays,
        DateTime localNow)
    {
        var localTime = TimeOnly.FromDateTime(localNow);
        var todayDate = DateOnly.FromDateTime(localNow);
        var previousDate = todayDate.AddDays(-1);
        var today = ResolveOpeningDefinition(todayDate, openingHours, specialOpeningDays);
        var previousDay = ResolveOpeningDefinition(previousDate, openingHours, specialOpeningDays);

        if (HasSpecialDate(todayDate, specialOpeningDays))
        {
            return today.IsOpen && today.Windows.Any(window => IsWindowActiveFromOpeningDay(window, localTime));
        }

        if (today.IsOpen)
        {
            if (today.Windows.Any(window => IsWindowActiveFromOpeningDay(window, localTime)))
            {
                return true;
            }
        }

        if (!previousDay.IsOpen)
        {
            return false;
        }

        return previousDay.Windows.Any(window => IsOvernightCarryoverActive(window, localTime));
    }

    private static bool HasSpecialDate(DateOnly date, IReadOnlyList<RestaurantSpecialOpeningDay> specialOpeningDays)
    {
        return specialOpeningDays.Any(day =>
            day.Date == date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    private static RestaurantResolvedOpeningDay ResolveOpeningDefinition(
        DateOnly date,
        IReadOnlyList<RestaurantOpeningHoursDay> openingHours,
        IReadOnlyList<RestaurantSpecialOpeningDay> specialOpeningDays)
    {
        var specialDay = specialOpeningDays.FirstOrDefault(day => day.Date == date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

        if (specialDay is not null)
        {
            return new RestaurantResolvedOpeningDay(
                !specialDay.IsClosed,
                specialDay.IsClosed ? [] : specialDay.Windows);
        }

        var regularDay = openingHours.First(day => day.DayOfWeek == (int)date.DayOfWeek);
        return new RestaurantResolvedOpeningDay(regularDay.IsOpen, regularDay.Windows);
    }

    private static DateTime ConvertToRestaurantTime(DateTime utcNow, string timezone)
    {
        var utcDateTime = DateTime.SpecifyKind(utcNow, DateTimeKind.Utc);
        var timeZoneInfo = ResolveTimeZone(timezone);
        return TimeZoneInfo.ConvertTimeFromUtc(utcDateTime, timeZoneInfo);
    }

    private static TimeZoneInfo ResolveTimeZone(string timezone)
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

    private static List<RestaurantOpeningHoursDay> CreateDefaultOpeningHours()
    {
        return Enumerable.Range(0, 7)
            .Select(dayOfWeek => new RestaurantOpeningHoursDay
            {
                DayOfWeek = dayOfWeek,
                IsOpen = true,
                Windows = [CreateDefaultWindow()]
            })
            .ToList();
    }

    private static List<RestaurantOpeningHoursWindow> NormalizeWindows(RestaurantOpeningHoursDayInput day)
    {
        if (day.Windows is { Count: > 0 })
        {
            return day.Windows
                .Select(window => new RestaurantOpeningHoursWindow
                {
                    OpensAt = window.OpensAt,
                    ClosesAt = window.ClosesAt
                })
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(day.OpensAt) && !string.IsNullOrWhiteSpace(day.ClosesAt))
        {
            return
            [
                new RestaurantOpeningHoursWindow
                {
                    OpensAt = day.OpensAt,
                    ClosesAt = day.ClosesAt
                }
            ];
        }

        return day.IsOpen ? [CreateDefaultWindow()] : [];
    }

    private static bool TryParseSpecialOpeningDays(
        string specialOpeningDaysJson,
        out List<RestaurantSpecialOpeningDay> specialOpeningDays,
        out string? error)
    {
        List<RestaurantSpecialOpeningDayInput>? parsed;

        try
        {
            parsed = JsonSerializer.Deserialize<List<RestaurantSpecialOpeningDayInput>>(specialOpeningDaysJson, JsonOptions);
        }
        catch (JsonException)
        {
            specialOpeningDays = [];
            error = "SpecialOpeningDaysJson must be a valid JSON array.";
            return false;
        }

        if (parsed is null)
        {
            specialOpeningDays = [];
            error = null;
            return true;
        }

        var normalized = new List<RestaurantSpecialOpeningDay>();
        var seenDates = new HashSet<string>(StringComparer.Ordinal);

        foreach (var day in parsed)
        {
            if (!DateOnly.TryParseExact(day.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            {
                specialOpeningDays = [];
                error = "Special day dates must use yyyy-MM-dd format.";
                return false;
            }

            var normalizedDate = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (!seenDates.Add(normalizedDate))
            {
                specialOpeningDays = [];
                error = "Special day dates must be unique.";
                return false;
            }

            var windows = NormalizeSpecialWindows(day);

            if (!day.IsClosed && windows.Count == 0)
            {
                specialOpeningDays = [];
                error = "Open special days must include at least one opening window.";
                return false;
            }

            if (windows.Count > 4)
            {
                specialOpeningDays = [];
                error = "Each special day can include up to four opening windows.";
                return false;
            }

            foreach (var window in windows)
            {
                if (!IsValidTime(window.OpensAt) || !IsValidTime(window.ClosesAt))
                {
                    specialOpeningDays = [];
                    error = "Special day times must use HH:mm format.";
                    return false;
                }

                if (string.Equals(window.OpensAt, window.ClosesAt, StringComparison.Ordinal)
                    && !IsFullDayWindow(window))
                {
                    specialOpeningDays = [];
                    error = "Special day opening and closing times cannot be the same, except 00:00 to 00:00 for 24 hours.";
                    return false;
                }
            }

            if (!day.IsClosed && HasOverlappingWindows(windows))
            {
                specialOpeningDays = [];
                error = "Special day opening windows must not overlap.";
                return false;
            }

            normalized.Add(new RestaurantSpecialOpeningDay
            {
                Date = normalizedDate,
                IsClosed = day.IsClosed,
                Note = string.IsNullOrWhiteSpace(day.Note) ? null : day.Note.Trim(),
                Windows = day.IsClosed ? [] : windows
            });
        }

        specialOpeningDays = normalized
            .OrderBy(day => day.Date, StringComparer.Ordinal)
            .ToList();
        error = null;
        return true;
    }

    private static RestaurantOpeningHoursWindow CreateDefaultWindow()
    {
        return new RestaurantOpeningHoursWindow
        {
            OpensAt = "09:00",
            ClosesAt = "21:00"
        };
    }

    private static List<RestaurantOpeningHoursWindow> NormalizeSpecialWindows(RestaurantSpecialOpeningDayInput day)
    {
        if (day.IsClosed)
        {
            return [];
        }

        if (day.Windows is { Count: > 0 })
        {
            return day.Windows
                .Select(window => new RestaurantOpeningHoursWindow
                {
                    OpensAt = window.OpensAt,
                    ClosesAt = window.ClosesAt
                })
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(day.OpensAt) && !string.IsNullOrWhiteSpace(day.ClosesAt))
        {
            return
            [
                new RestaurantOpeningHoursWindow
                {
                    OpensAt = day.OpensAt,
                    ClosesAt = day.ClosesAt
                }
            ];
        }

        return [];
    }

    private static bool IsWindowActiveFromOpeningDay(RestaurantOpeningHoursWindow window, TimeOnly localTime)
    {
        if (IsFullDayWindow(window))
        {
            return true;
        }

        var opensAt = ParseTime(window.OpensAt);
        var closesAt = ParseTime(window.ClosesAt);

        return closesAt > opensAt
            ? localTime >= opensAt && localTime < closesAt
            : localTime >= opensAt;
    }

    private static bool IsOvernightCarryoverActive(RestaurantOpeningHoursWindow window, TimeOnly localTime)
    {
        if (IsFullDayWindow(window))
        {
            return false;
        }

        var opensAt = ParseTime(window.OpensAt);
        var closesAt = ParseTime(window.ClosesAt);
        return closesAt <= opensAt && localTime < closesAt;
    }

    private static bool IsFullDayWindow(RestaurantOpeningHoursWindow window)
    {
        return string.Equals(window.OpensAt, "00:00", StringComparison.Ordinal)
            && string.Equals(window.ClosesAt, "00:00", StringComparison.Ordinal);
    }

    private static bool HasOverlappingWindows(IReadOnlyList<RestaurantOpeningHoursWindow> windows)
    {
        var ranges = windows
            .Select(window =>
            {
                var opensAt = ToMinutes(ParseTime(window.OpensAt));
                var closesAt = ToMinutes(ParseTime(window.ClosesAt));
                return new OpeningWindowRange(opensAt, closesAt > opensAt ? closesAt : closesAt + 24 * 60);
            })
            .OrderBy(range => range.Start)
            .ToList();

        for (var index = 1; index < ranges.Count; index++)
        {
            if (ranges[index].Start < ranges[index - 1].End)
            {
                return true;
            }
        }

        return false;
    }

    private static int ToMinutes(TimeOnly value)
    {
        return value.Hour * 60 + value.Minute;
    }

    private static bool IsValidTime(string value)
    {
        return TimeOnly.TryParseExact(value, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
    }

    private static TimeOnly ParseTime(string value)
    {
        return TimeOnly.ParseExact(value, "HH:mm", CultureInfo.InvariantCulture);
    }
}

internal sealed class RestaurantOpeningHoursDayInput
{
    public int DayOfWeek { get; set; }

    public bool IsOpen { get; set; } = true;

    public string? OpensAt { get; set; }

    public string? ClosesAt { get; set; }

    public List<RestaurantOpeningHoursWindow>? Windows { get; set; }
}

internal sealed class RestaurantSpecialOpeningDayInput
{
    public string Date { get; set; } = string.Empty;

    public bool IsClosed { get; set; } = true;

    public string? Note { get; set; }

    public string? OpensAt { get; set; }

    public string? ClosesAt { get; set; }

    public List<RestaurantOpeningHoursWindow>? Windows { get; set; }
}

public sealed class RestaurantOpeningHoursDay
{
    public int DayOfWeek { get; set; }

    public bool IsOpen { get; set; } = true;

    public List<RestaurantOpeningHoursWindow> Windows { get; set; } = [];
}

public sealed class RestaurantSpecialOpeningDay
{
    public string Date { get; set; } = string.Empty;

    public bool IsClosed { get; set; } = true;

    public string? Note { get; set; }

    public List<RestaurantOpeningHoursWindow> Windows { get; set; } = [];
}

public sealed class RestaurantOpeningHoursWindow
{
    public string OpensAt { get; set; } = "09:00";

    public string ClosesAt { get; set; } = "21:00";
}

internal sealed record OpeningWindowRange(int Start, int End);

internal sealed record RestaurantResolvedOpeningDay(bool IsOpen, IReadOnlyList<RestaurantOpeningHoursWindow> Windows);

internal sealed record OpeningInterval(DateTime Start, DateTime End);

public sealed record RestaurantOrderingAvailability(
    bool IsOrderingAvailable,
    bool IsWithinOpeningHours,
    bool AcceptingOrders,
    string Reason,
    string Message,
    /// <summary>Restaurant-local time the open/closed state next flips; null when it never does.</summary>
    DateTime? NextTransitionLocal,
    /// <summary>
    /// Restaurant-local time of the next opening. While trading this is the *next* opening, not the
    /// current one, so it can be offered as "closed for today, back tomorrow".
    /// </summary>
    DateTime? NextOpeningLocal,
    /// <summary>UTC instant a timed pause lapses; null when not paused or paused indefinitely.</summary>
    DateTime? PausedUntilUtc);
