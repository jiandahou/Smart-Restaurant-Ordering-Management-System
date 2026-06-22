using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Extensions;
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
    public async Task<ActionResult<PagedResponse<RestaurantResponse>>> GetRestaurants(
        [FromQuery] RestaurantListRequest request,
        CancellationToken cancellationToken)
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

        if (request.IsActive.HasValue)
        {
            query = query.Where(restaurant => restaurant.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.Currency))
        {
            var currency = request.Currency.Trim().ToUpperInvariant();
            query = query.Where(restaurant => restaurant.Currency == currency);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(restaurant =>
                EF.Functions.ILike(restaurant.Name, pattern) ||
                EF.Functions.ILike(restaurant.Address, pattern) ||
                EF.Functions.ILike(restaurant.Phone, pattern) ||
                EF.Functions.ILike(restaurant.Timezone, pattern) ||
                EF.Functions.ILike(restaurant.Currency, pattern));
        }

        var sortedQuery = ApplySorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "name", "address", "currency", "status", "createdAt", "updatedAt" }
            });
        }

        var responseQuery = sortedQuery.Select(restaurant => new RestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            PaymentPolicy = restaurant.PaymentPolicy.ToString(),
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        });
        var page = await responseQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(page);
    }

    private static IOrderedQueryable<Restaurant>? ApplySorting(
        IQueryable<Restaurant> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "name" : sortBy.Trim();
        IOrderedQueryable<Restaurant>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "name" => descending ? query.OrderByDescending(restaurant => restaurant.Name) : query.OrderBy(restaurant => restaurant.Name),
            "address" => descending ? query.OrderByDescending(restaurant => restaurant.Address) : query.OrderBy(restaurant => restaurant.Address),
            "currency" => descending ? query.OrderByDescending(restaurant => restaurant.Currency) : query.OrderBy(restaurant => restaurant.Currency),
            "status" => descending ? query.OrderByDescending(restaurant => restaurant.IsActive) : query.OrderBy(restaurant => restaurant.IsActive),
            "createdat" => descending ? query.OrderByDescending(restaurant => restaurant.CreatedAt) : query.OrderBy(restaurant => restaurant.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(restaurant => restaurant.UpdatedAt) : query.OrderBy(restaurant => restaurant.UpdatedAt),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(restaurant => restaurant.Id)
                : sorted.ThenBy(restaurant => restaurant.Id);
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
            PaymentPolicy = Enum.Parse<RestaurantPaymentPolicy>(request.PaymentPolicy, true),
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
        restaurant.PaymentPolicy = Enum.Parse<RestaurantPaymentPolicy>(request.PaymentPolicy, true);
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

        if (!Enum.TryParse<RestaurantPaymentPolicy>(request.PaymentPolicy, true, out var paymentPolicy) ||
            !Enum.IsDefined(paymentPolicy))
        {
            return $"PaymentPolicy must be one of: {string.Join(", ", Enum.GetNames<RestaurantPaymentPolicy>())}.";
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
            PaymentPolicy = restaurant.PaymentPolicy.ToString(),
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        };
    }
}
