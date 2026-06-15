using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class RestaurantController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;

    public RestaurantController(AppDbContext dbContext, UserManager<ApplicationUser> userManager)
    {
        _dbContext = dbContext;
        _userManager = userManager;
    }

    [HttpGet]
    public async Task<IActionResult> GetRestaurants()
    {
        var query = _dbContext.Restaurants.AsNoTracking();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            var restaurantId = await GetCurrentRestaurantIdAsync();

            if (restaurantId is null)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "Current user is not assigned to a restaurant."
                });
            }

            query = query.Where(restaurant => restaurant.Id == restaurantId);
        }

        var restaurants = await query
            .OrderBy(restaurant => restaurant.Name)
            .ToListAsync();
        var responses = restaurants.Select(MapToResponse).ToList();
        return Ok(responses);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetRestaurant(Guid id)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await _dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        return Ok(MapToResponse(restaurant));
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPost]
    public async Task<IActionResult> CreateRestaurant([FromBody] RestaurantRequest request)
    {
        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Address = request.Address.Trim(),
            Phone = request.Phone.Trim(),
            Timezone = request.Timezone.Trim(),
            Currency = request.Currency.Trim().ToUpperInvariant(),
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = null
        };

        await _dbContext.Restaurants.AddAsync(restaurant);
        await _dbContext.SaveChangesAsync();

        var response = MapToResponse(restaurant);
        return CreatedAtAction(nameof(GetRestaurant), new { id = restaurant.Id }, response);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateRestaurant(Guid id, [FromBody] RestaurantRequest request)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        restaurant.Name = request.Name.Trim();
        restaurant.Address = request.Address.Trim();
        restaurant.Phone = request.Phone.Trim();
        restaurant.Timezone = request.Timezone.Trim();
        restaurant.Currency = request.Currency.Trim().ToUpperInvariant();
        restaurant.IsActive = request.IsActive;
        restaurant.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Restaurant updated successfully.",
            restaurant = MapToResponse(restaurant)
        });
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteRestaurant(Guid id)
    {
        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        _dbContext.Restaurants.Remove(restaurant);
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Restaurant deleted successfully.",
            restaurantId = id
        });
    }

    private async Task<Guid?> GetCurrentRestaurantIdAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return null;
        }

        var currentUser = await _userManager.FindByIdAsync(currentUserId);
        return currentUser?.RestaurantId;
    }

    private async Task<bool> CanAccessRestaurantAsync(Guid restaurantId)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        return await GetCurrentRestaurantIdAsync() == restaurantId;
    }

    private static string? ValidateRequest(RestaurantRequest? request)
    {
        if (request is null)
        {
            return "Restaurant data is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return "Restaurant name is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Address))
        {
            return "Restaurant address is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Phone))
        {
            return "Restaurant phone is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Timezone))
        {
            return "Restaurant timezone is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Currency) || request.Currency.Trim().Length != 3)
        {
            return "Currency must be a three-letter ISO code.";
        }

        return null;
    }

    private static RestaurantResponse MapToResponse(Restaurant restaurant)
    {
        return new RestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        };
    }
}
