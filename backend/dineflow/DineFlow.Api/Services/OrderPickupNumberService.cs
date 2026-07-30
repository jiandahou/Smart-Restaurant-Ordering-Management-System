using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Api.Services;

public sealed class OrderPickupNumberService(AppDbContext dbContext)
{
    public async Task AssignPickupNumberAsync(
        Order order,
        RestaurantEntity restaurant,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        if (order.RestaurantId is null || order.PickupNumber.HasValue)
        {
            return;
        }

        var pickupDate = ResolvePickupDate(order, restaurant, utcNow);

        order.PickupDate = pickupDate;
        order.PickupNumber = await AllocateNumberAsync(
            order.RestaurantId.Value,
            pickupDate,
            cancellationToken);
    }

    /// <summary>
    /// Dine-in, takeaway and scheduled orders all draw from one sequence per restaurant per day,
    /// so a called number is unambiguous across the whole venue. Scheduled orders are numbered
    /// against the day they are collected, not the day they were placed.
    /// </summary>
    private static DateOnly ResolvePickupDate(Order order, RestaurantEntity restaurant, DateTime utcNow)
    {
        var reference = order.OrderType == OrderType.Scheduled && order.ScheduledTime.HasValue
            ? order.ScheduledTime.Value
            : utcNow;

        return DateOnly.FromDateTime(ConvertToRestaurantTime(reference, restaurant.Timezone));
    }

    /// <summary>
    /// Allocates the next number in a single atomic statement. The counter row is created on the
    /// day's first order, seeded from any numbers already present in Orders so the sequence stays
    /// consistent even if a row was written outside this service.
    /// </summary>
    private async Task<int> AllocateNumberAsync(
        Guid restaurantId,
        DateOnly pickupDate,
        CancellationToken cancellationToken)
    {
        var allocated = await dbContext.Database
            .SqlQuery<int>($"""
                INSERT INTO "RestaurantPickupCounters" ("RestaurantId", "PickupDate", "LastNumber")
                VALUES (
                    {restaurantId},
                    {pickupDate},
                    COALESCE((
                        SELECT MAX("PickupNumber")
                        FROM "Orders"
                        WHERE "RestaurantId" = {restaurantId}
                          AND "PickupDate" = {pickupDate}
                    ), 0) + 1)
                ON CONFLICT ("RestaurantId", "PickupDate")
                DO UPDATE SET "LastNumber" = "RestaurantPickupCounters"."LastNumber" + 1
                RETURNING "LastNumber" AS "Value"
                """)
            .ToListAsync(cancellationToken);

        return allocated[0];
    }

    /// <summary>
    /// The restaurant's current business day. Pickup numbers reset on this boundary, so the
    /// counter UI must label "today" against it rather than the browser's local date.
    /// </summary>
    public static DateOnly GetBusinessDate(string timezone, DateTime utcNow) =>
        DateOnly.FromDateTime(ConvertToRestaurantTime(utcNow, timezone));

    public static string FormatPickupCode(int? pickupNumber) =>
        pickupNumber.HasValue ? $"#{pickupNumber.Value:D3}" : string.Empty;

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
}
