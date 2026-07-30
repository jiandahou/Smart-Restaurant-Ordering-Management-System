using DineFlow.Api.Contracts.Ordering;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/public/ordering")]
public class PublicOrderingController(
    AppDbContext dbContext,
    RestaurantOperatingHoursService restaurantOperatingHoursService) : ControllerBase
{
    [HttpGet("restaurants/{restaurantId:guid}")]
    public async Task<IActionResult> GetRestaurantOrderingContext(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .Where(item => item.Id == restaurantId && item.IsActive)
            .FirstOrDefaultAsync(cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant is not available for ordering." });
        }

        return Ok(new PublicOrderingContextResponse
        {
            Restaurant = MapRestaurant(restaurant),
            Table = null,
            OrderType = OrderType.Takeaway.ToString(),
            AvailableOrderTypes = [OrderType.DineIn.ToString(), OrderType.Takeaway.ToString()],
            MenuEntryUrl = $"/r/{restaurant.Id}/menu"
        });
    }

    [HttpGet("tables/{qrToken}")]
    public async Task<IActionResult> ResolveTableOrderingContext(
        string qrToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(qrToken))
        {
            return BadRequest(new { message = "Table QR token is required." });
        }

        var context = await (
                from table in dbContext.RestaurantTables.AsNoTracking()
                join restaurant in dbContext.Restaurants.AsNoTracking()
                    on table.RestaurantId equals restaurant.Id
                where table.QrToken == qrToken && table.IsActive && restaurant.IsActive
                select new { Table = table, Restaurant = restaurant })
            .FirstOrDefaultAsync(cancellationToken);

        if (context is null)
        {
            return NotFound(new { message = "Table QR code is invalid or unavailable." });
        }

        return Ok(new PublicOrderingContextResponse
        {
            Restaurant = MapRestaurant(context.Restaurant),
            Table = new PublicOrderingTableResponse
            {
                Id = context.Table.Id,
                TableNumber = context.Table.TableNumber,
                Capacity = context.Table.Capacity
            },
            OrderType = OrderType.DineIn.ToString(),
            AvailableOrderTypes = [OrderType.DineIn.ToString()],
            MenuEntryUrl = $"/table/{context.Table.QrToken}"
        });
    }

    private PublicOrderingRestaurantResponse MapRestaurant(DineFlow.Infrastructure.Restaurant.Restaurant restaurant)
    {
        var availability = restaurantOperatingHoursService.GetAvailability(restaurant);

        return new PublicOrderingRestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            ImageUrl = restaurant.ImageUrl,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            PaymentPolicy = restaurant.PaymentPolicy.ToString(),
            OnlinePaymentsEnabled = !string.IsNullOrWhiteSpace(restaurant.StripeAccountId) &&
                restaurant.StripeChargesEnabled,
            AcceptingOrders = availability.AcceptingOrders,
            OpeningHoursJson = restaurant.OpeningHoursJson,
            SpecialOpeningDaysJson = restaurant.SpecialOpeningDaysJson,
            IsWithinOpeningHours = availability.IsWithinOpeningHours,
            IsOrderingAvailable = availability.IsOrderingAvailable,
            OrderingUnavailableReason = availability.Reason,
            OrderingStatusMessage = availability.Message
        };
    }
}
