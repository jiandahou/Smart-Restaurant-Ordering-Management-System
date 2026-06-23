using DineFlow.Api.Contracts.Ordering;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/public/ordering")]
public class PublicOrderingController(AppDbContext dbContext) : ControllerBase
{
    [HttpGet("restaurants/{restaurantId:guid}")]
    public async Task<IActionResult> GetRestaurantOrderingContext(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .Where(item => item.Id == restaurantId && item.IsActive)
            .Select(item => new PublicOrderingRestaurantResponse
            {
                Id = item.Id,
                Name = item.Name,
                Address = item.Address,
                Phone = item.Phone,
                Timezone = item.Timezone,
                Currency = item.Currency,
                PaymentPolicy = item.PaymentPolicy.ToString()
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant is not available for ordering." });
        }

        return Ok(new PublicOrderingContextResponse
        {
            Restaurant = restaurant,
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
                select new PublicOrderingContextResponse
                {
                    Restaurant = new PublicOrderingRestaurantResponse
                    {
                        Id = restaurant.Id,
                        Name = restaurant.Name,
                        Address = restaurant.Address,
                        Phone = restaurant.Phone,
                        Timezone = restaurant.Timezone,
                        Currency = restaurant.Currency,
                        PaymentPolicy = restaurant.PaymentPolicy.ToString()
                    },
                    Table = new PublicOrderingTableResponse
                    {
                        Id = table.Id,
                        TableNumber = table.TableNumber,
                        Capacity = table.Capacity
                    },
                    OrderType = OrderType.DineIn.ToString(),
                    AvailableOrderTypes = new[] { OrderType.DineIn.ToString() },
                    MenuEntryUrl = $"/table/{table.QrToken}"
                })
            .FirstOrDefaultAsync(cancellationToken);

        if (context is null)
        {
            return NotFound(new { message = "Table QR code is invalid or unavailable." });
        }

        return Ok(context);
    }
}
