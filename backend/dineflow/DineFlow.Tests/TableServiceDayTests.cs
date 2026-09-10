using DineFlow.Infrastructure.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Where one sitting ends and the next begins.
/// </summary>
/// <remarks>
/// The boundary is a closing hour rather than midnight, and the reason is the late table: a party
/// seated at half past eleven that orders again after twelve is one dinner. Splitting it would hand
/// them two bills for one meal, which is the kind of wrong a customer notices before the software
/// does.
/// </remarks>
public class TableServiceDayTests
{
    private const string Adelaide = "Australia/Adelaide";

    /// <summary>UTC for a wall-clock time in Adelaide, which runs 9:30 or 10:30 ahead.</summary>
    private static DateTime LocalAsUtc(int year, int month, int day, int hour, int minute) =>
        DineFlow.Infrastructure.Time.RestaurantClock.ToUtc(
            new DateTime(year, month, day, hour, minute, 0),
            Adelaide);

    /// <summary>The case the closing hour exists for.</summary>
    [Fact]
    public void ATableSeatedBeforeMidnightIsStillTheSameSittingAfterIt()
    {
        var seated = LocalAsUtc(2026, 9, 9, 23, 30);
        var secondRound = LocalAsUtc(2026, 9, 10, 0, 40);

        Assert.True(TableServiceDay.IsSameService(seated, secondRound, Adelaide));
    }

    /// <summary>And still the same at three, which is late but is not tomorrow.</summary>
    [Fact]
    public void ItHoldsUntilTheClosingHour()
    {
        var seated = LocalAsUtc(2026, 9, 9, 22, 0);

        Assert.True(TableServiceDay.IsSameService(seated, LocalAsUtc(2026, 9, 10, 3, 59), Adelaide));
        Assert.False(TableServiceDay.IsSameService(seated, LocalAsUtc(2026, 9, 10, 4, 0), Adelaide));
    }

    /// <summary>
    /// Lunch and dinner on one day are one service day. The rule bounds a bill's age; it is not an
    /// attempt to tell one sitting from the next within a day, which only settling can do.
    /// </summary>
    [Fact]
    public void LunchAndDinnerAreTheSameServiceDay()
    {
        Assert.True(TableServiceDay.IsSameService(
            LocalAsUtc(2026, 9, 9, 12, 15),
            LocalAsUtc(2026, 9, 9, 20, 45),
            Adelaide));
    }

    /// <summary>The failure this was written for: a bill that ran for a month.</summary>
    [Fact]
    public void ASessionFromLastMonthIsNotTonight()
    {
        Assert.False(TableServiceDay.IsSameService(
            LocalAsUtc(2026, 8, 12, 19, 0),
            LocalAsUtc(2026, 9, 10, 19, 0),
            Adelaide));
    }

    /// <summary>A service day is named by the day it opened, the way the people working it name it.</summary>
    [Fact]
    public void AServiceDayIsNamedByTheEveningItStarted()
    {
        Assert.Equal(new DateOnly(2026, 9, 9), TableServiceDay.For(LocalAsUtc(2026, 9, 9, 19, 0), Adelaide));
        Assert.Equal(new DateOnly(2026, 9, 9), TableServiceDay.For(LocalAsUtc(2026, 9, 10, 2, 0), Adelaide));
        Assert.Equal(new DateOnly(2026, 9, 10), TableServiceDay.For(LocalAsUtc(2026, 9, 10, 11, 0), Adelaide));
    }

    /// <summary>
    /// The zone is the restaurant's, not the server's. Read in UTC, an Adelaide dinner falls on the
    /// previous day and every boundary lands in the middle of service.
    /// </summary>
    [Fact]
    public void ItAsksTheRestaurantsOwnClock()
    {
        // One instant, two restaurants. In Adelaide the clock reads half past four in the morning,
        // so that service is over and the next has begun; in London it is eight in the evening and
        // dinner is in full swing.
        var moment = new DateTime(2026, 9, 9, 19, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 10), TableServiceDay.For(moment, Adelaide));
        Assert.Equal(new DateOnly(2026, 9, 9), TableServiceDay.For(moment, "Europe/London"));
    }

    /// <summary>A mistyped zone should misplace a boundary, not fail the scan at the door.</summary>
    [Fact]
    public void AnUnknownTimeZoneFallsBackRatherThanThrowing()
    {
        var moment = new DateTime(2026, 9, 9, 19, 0, 0, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(2026, 9, 9), TableServiceDay.For(moment, "Not/AZone"));
    }
}
