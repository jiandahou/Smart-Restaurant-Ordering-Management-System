using DineFlow.Api.Services;
using DineFlow.Infrastructure.Restaurant;
using Xunit;

namespace DineFlow.Tests;

public class RestaurantOperatingHoursServiceTests
{
    private const string FullDayMondayJson =
        "[{\"dayOfWeek\":0,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":2,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

    [Fact]
    public void TryNormalizeOpeningHoursJson_AcceptsMidnightToMidnightAsFullDay()
    {
        var service = new RestaurantOperatingHoursService();

        var result = service.TryNormalizeOpeningHoursJson(
            FullDayMondayJson,
            out var normalized,
            out var error);

        Assert.True(result);
        Assert.Null(error);
        Assert.Contains("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", normalized);
    }

    [Fact]
    public void TryNormalizeOpeningHoursJson_RejectsOtherIdenticalTimes()
    {
        var service = new RestaurantOperatingHoursService();
        var invalid = FullDayMondayJson
            .Replace("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", "\"opensAt\":\"09:00\",\"closesAt\":\"09:00\"");

        var result = service.TryNormalizeOpeningHoursJson(invalid, out _, out var error);

        Assert.False(result);
        Assert.Contains("except 00:00 to 00:00", error);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(8, 30)]
    [InlineData(23, 59)]
    public void GetAvailability_MidnightToMidnight_IsOpenForTheWholeDay(int hour, int minute)
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = new Restaurant
        {
            IsActive = true,
            AcceptingOrders = true,
            Timezone = "UTC",
            OpeningHoursJson = FullDayMondayJson
        };
        var monday = new DateTime(2026, 7, 27, hour, minute, 0, DateTimeKind.Utc);

        var availability = service.GetAvailability(restaurant, monday);

        Assert.True(availability.IsWithinOpeningHours);
        Assert.True(availability.IsOrderingAvailable);
    }

    [Fact]
    public void TryNormalizeSpecialOpeningDaysJson_AcceptsMidnightToMidnightAsFullDay()
    {
        var service = new RestaurantOperatingHoursService();
        const string specialDay =
            "[{\"date\":\"2026-07-27\",\"isClosed\":false,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}]";

        var result = service.TryNormalizeSpecialOpeningDaysJson(
            specialDay,
            out var normalized,
            out var error);

        Assert.True(result);
        Assert.Null(error);
        Assert.Contains("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", normalized);
    }

    [Fact]
    public void GetAvailability_WhenOpen_ReportsClosingTimeAsNextTransition()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));

        // Monday 12:00 local, inside the 09:00-21:00 window.
        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.True(availability.IsWithinOpeningHours);
        Assert.Equal(new DateTime(2026, 7, 27, 21, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void GetAvailability_WhenClosed_ReportsNextOpeningAsNextTransition()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));

        // Monday 22:00, after close: the next flip is Tuesday's opening.
        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 22, 0, 0, DateTimeKind.Utc));

        Assert.False(availability.IsWithinOpeningHours);
        Assert.Equal(new DateTime(2026, 7, 28, 9, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void GetAvailability_BackToBackWindows_SkipsToEndOfContiguousRun()
    {
        var service = new RestaurantOperatingHoursService();
        // 09:00-14:00 then 14:00-21:00 — no actual closure at 14:00.
        var restaurant = CreateRestaurant(DailyJson("09:00", "14:00", "14:00", "21:00"));

        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.True(availability.IsWithinOpeningHours);
        Assert.Equal(new DateTime(2026, 7, 27, 21, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void GetAvailability_OvernightWindow_StaysOpenPastMidnight()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("17:00", "02:00"));

        // Tuesday 01:00 is still Monday's service.
        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 28, 1, 0, 0, DateTimeKind.Utc));

        Assert.True(availability.IsWithinOpeningHours);
        Assert.Equal(new DateTime(2026, 7, 28, 2, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void GetAvailability_TwentyFourSeven_HasNoNextTransition()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("00:00", "00:00"));

        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.True(availability.IsWithinOpeningHours);
        Assert.Null(availability.NextTransitionLocal);
    }

    [Fact]
    public void GetAvailability_SpecialClosure_PushesNextOpeningToTheFollowingDay()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));
        restaurant.SpecialOpeningDaysJson = "[{\"date\":\"2026-07-28\",\"isClosed\":true,\"windows\":[]}]";

        // Monday 22:00: Tuesday is closed, so the next opening is Wednesday.
        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 22, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 29, 9, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void IsAcceptingOrders_TimedPause_ResumesOnceItLapses()
    {
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));
        restaurant.AcceptingOrders = false;
        restaurant.AcceptingOrdersPausedUntil = new DateTime(2026, 7, 27, 12, 30, 0, DateTimeKind.Utc);

        Assert.False(RestaurantOperatingHoursService.IsAcceptingOrders(
            restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc)));
        Assert.True(RestaurantOperatingHoursService.IsAcceptingOrders(
            restaurant, new DateTime(2026, 7, 27, 12, 31, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void GetAvailability_IndefinitePause_StaysPaused()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));
        restaurant.AcceptingOrders = false;
        restaurant.AcceptingOrdersPausedUntil = null;

        var availability = service.GetAvailability(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal("Paused", availability.Reason);
        Assert.False(availability.IsOrderingAvailable);
        // Still reports the schedule's next flip so the UI can say when the day ends.
        Assert.Equal(new DateTime(2026, 7, 27, 21, 0, 0), availability.NextTransitionLocal);
    }

    [Fact]
    public void GetNextOpeningUtc_WhileOpen_SkipsPastTodaysTrading()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));

        // Monday 12:00, mid-service: "pause until we next open" must mean Tuesday, not right now.
        var next = service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 28, 9, 0, 0, DateTimeKind.Utc), next);
    }

    [Fact]
    public void GetNextOpeningUtc_WhileClosed_ReturnsTheUpcomingOpening()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));

        var next = service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 22, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 28, 9, 0, 0, DateTimeKind.Utc), next);
    }

    [Fact]
    public void GetNextOpeningUtc_BackToBackWindows_SkipsTheWholeRun()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "14:00", "14:00", "21:00"));

        // 14:00 is not a real closure, so the next opening is still tomorrow.
        var next = service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 28, 9, 0, 0, DateTimeKind.Utc), next);
    }

    [Fact]
    public void GetNextOpeningUtc_SkipsASpecialClosure()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));
        restaurant.SpecialOpeningDaysJson = "[{\"date\":\"2026-07-28\",\"isClosed\":true,\"windows\":[]}]";

        var next = service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 29, 9, 0, 0, DateTimeKind.Utc), next);
    }

    [Fact]
    public void GetNextOpeningUtc_TwentyFourSeven_HasNoNextOpening()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("00:00", "00:00"));

        // Never closes, so there is nothing to resume at — the caller must reject this choice.
        Assert.Null(service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void GetNextOpeningUtc_HonoursTheRestaurantTimezone()
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = CreateRestaurant(DailyJson("09:00", "21:00"));
        restaurant.Timezone = "Australia/Brisbane"; // UTC+10, no daylight saving

        // 2026-07-27 12:00Z is 22:00 local Monday — already shut, so the next opening is
        // Tuesday 09:00 local, which is Monday 23:00 UTC.
        var next = service.GetNextOpeningUtc(restaurant, new DateTime(2026, 7, 27, 12, 0, 0, DateTimeKind.Utc));

        Assert.Equal(new DateTime(2026, 7, 27, 23, 0, 0, DateTimeKind.Utc), next);
    }

    private static Restaurant CreateRestaurant(string openingHoursJson) => new()
    {
        IsActive = true,
        AcceptingOrders = true,
        Timezone = "UTC",
        OpeningHoursJson = openingHoursJson,
        SpecialOpeningDaysJson = "[]"
    };

    /// <summary>Builds a seven-day schedule where every day uses the same window(s).</summary>
    private static string DailyJson(params string[] times)
    {
        var windows = string.Join(",", Enumerable
            .Range(0, times.Length / 2)
            .Select(index => $"{{\"opensAt\":\"{times[index * 2]}\",\"closesAt\":\"{times[index * 2 + 1]}\"}}"));

        var days = string.Join(",", Enumerable
            .Range(0, 7)
            .Select(day => $"{{\"dayOfWeek\":{day},\"isOpen\":true,\"windows\":[{windows}]}}"));

        return $"[{days}]";
    }
}
