using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/staff/restaurants")]
[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public class RestaurantOperationsController(
    AppDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    RestaurantOperatingHoursService restaurantOperatingHoursService,
    ReportLogWriter reportLogWriter) : ControllerBase
{
    /// <summary>
    /// The caller's own restaurant trading status. Staff have no access to the admin restaurant
    /// API, so this is how the dashboard answers "are we open right now?" for them.
    /// </summary>
    [HttpGet("current/trading-status")]
    public async Task<ActionResult<RestaurantTradingStatusResponse>> GetCurrentTradingStatus(
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return Forbid();
        }

        var currentUser = await userManager.FindByIdAsync(userId);
        if (currentUser?.RestaurantId is null)
        {
            return NotFound(new { message = "This account is not assigned to a restaurant." });
        }

        return await GetTradingStatusAsync(currentUser.RestaurantId.Value, cancellationToken);
    }

    [HttpGet("{id:guid}/trading-status")]
    public async Task<ActionResult<RestaurantTradingStatusResponse>> GetTradingStatus(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        return await GetTradingStatusAsync(id, cancellationToken);
    }

    private async Task<ActionResult<RestaurantTradingStatusResponse>> GetTradingStatusAsync(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == restaurantId, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var utcNow = DateTime.UtcNow;
        var availability = restaurantOperatingHoursService.GetAvailability(restaurant, utcNow);

        return Ok(new RestaurantTradingStatusResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Timezone = restaurant.Timezone,
            IsActive = restaurant.IsActive,
            AcceptingOrders = restaurant.AcceptingOrders,
            AcceptingOrdersPausedUntil = restaurant.AcceptingOrdersPausedUntil,
            OpeningHoursJson = restaurant.OpeningHoursJson,
            SpecialOpeningDaysJson = restaurant.SpecialOpeningDaysJson,
            Availability = new RestaurantAvailabilityResponse
            {
                IsOrderingAvailable = availability.IsOrderingAvailable,
                IsWithinOpeningHours = availability.IsWithinOpeningHours,
                AcceptingOrders = availability.AcceptingOrders,
                Reason = availability.Reason,
                Message = availability.Message,
                NextTransitionLocal = availability.NextTransitionLocal,
                NextOpeningLocal = availability.NextOpeningLocal,
                LocalNow = RestaurantOperatingHoursService.GetLocalNow(restaurant, utcNow),
                PausedUntilUtc = availability.PausedUntilUtc
            }
        });
    }

    [HttpGet("{id:guid}/operations")]
    public async Task<ActionResult<RestaurantOperationsResponse>> GetOperations(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        return restaurant is null
            ? NotFound(new { message = "Restaurant not found." })
            : Ok(MapToResponse(restaurant));
    }

    [HttpPatch("{id:guid}/auto-accept")]
    public async Task<ActionResult<RestaurantOperationsResponse>> UpdateAutoAccept(
        Guid id,
        RestaurantAutoAcceptRequest request,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var previousValue = restaurant.AutoAcceptOrders;
        restaurant.AutoAcceptOrders = request.AutoAcceptOrders;
        restaurant.UpdatedAt = DateTime.UtcNow;
        reportLogWriter.AddAudit(
            request.AutoAcceptOrders ? "Restaurant.AutoAcceptEnabled" : "Restaurant.AutoAcceptDisabled",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            request.AutoAcceptOrders
                ? $"Enabled automatic order acceptance for {restaurant.Name}."
                : $"Disabled automatic order acceptance for {restaurant.Name}.",
            before: new { autoAcceptOrders = previousValue },
            after: new { restaurant.AutoAcceptOrders });
        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapToResponse(restaurant));
    }

    private async Task<bool> CanAccessRestaurantAsync(Guid restaurantId)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return false;
        }

        var currentUser = await userManager.FindByIdAsync(userId);
        return currentUser?.RestaurantId == restaurantId;
    }

    private static RestaurantOperationsResponse MapToResponse(
        DineFlow.Infrastructure.Restaurant.Restaurant restaurant) => new()
    {
        Id = restaurant.Id,
        Name = restaurant.Name,
        AutoAcceptOrders = restaurant.AutoAcceptOrders
    };
}
