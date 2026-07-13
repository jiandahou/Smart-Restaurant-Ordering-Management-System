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

        var pickupDate = DateOnly.FromDateTime(ConvertToRestaurantTime(utcNow, restaurant.Timezone));
        var latestPickupNumber = await dbContext.Orders
            .Where(item =>
                item.RestaurantId == order.RestaurantId &&
                item.PickupDate == pickupDate &&
                item.PickupNumber.HasValue)
            .MaxAsync(item => (int?)item.PickupNumber, cancellationToken) ?? 0;

        order.PickupDate = pickupDate;
        order.PickupNumber = latestPickupNumber + 1;
    }

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
