using DineFlow.Api.Contracts.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/public/menu")]
public class PublicMenuController(AppDbContext dbContext) : ControllerBase
{
    [HttpGet("restaurants/{restaurantId:guid}")]
    public async Task<IActionResult> GetRestaurantMenu(
        Guid restaurantId,
        [FromQuery] string? search,
        [FromQuery(Name = "q")] string? query,
        CancellationToken cancellationToken)
    {
        var restaurantIsActive = await dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(
                restaurant => restaurant.Id == restaurantId && restaurant.IsActive,
                cancellationToken);

        if (!restaurantIsActive)
        {
            return NotFound(new { message = "Restaurant is not available for ordering." });
        }

        var searchTerm = string.IsNullOrWhiteSpace(search)
            ? query?.Trim()
            : search.Trim();

        if (searchTerm?.Length > 120)
        {
            return BadRequest(new { message = "Search cannot exceed 120 characters." });
        }

        var searchPattern = string.IsNullOrWhiteSpace(searchTerm) ? null : $"%{searchTerm}%";
        var categoriesQuery = dbContext.MenuCategories
            .AsNoTracking()
            .Where(category => category.RestaurantId == restaurantId && category.IsActive);

        if (searchPattern is not null)
        {
            categoriesQuery = categoriesQuery.Where(category => category.MenuItems.Any(item =>
                item.RestaurantId == restaurantId &&
                item.IsAvailable &&
                (
                    EF.Functions.ILike(item.Name, searchPattern) ||
                    (item.Description != null && EF.Functions.ILike(item.Description, searchPattern)) ||
                    item.OptionGroups.Any(group =>
                        group.IsActive &&
                        (
                            EF.Functions.ILike(group.Name, searchPattern) ||
                            group.Options.Any(option =>
                                option.IsAvailable &&
                                EF.Functions.ILike(option.Name, searchPattern))
                        ))
                )));
        }

        var categories = await categoriesQuery
            .OrderBy(category => category.DisplayOrder)
            .ThenBy(category => category.Name)
            .Select(category => new PublicMenuCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Description = category.Description,
                DisplayOrder = category.DisplayOrder,
                Items = category.MenuItems
                    .Where(item =>
                        item.RestaurantId == restaurantId &&
                        item.IsAvailable &&
                        (searchPattern == null ||
                            EF.Functions.ILike(item.Name, searchPattern) ||
                            (item.Description != null && EF.Functions.ILike(item.Description, searchPattern)) ||
                            item.OptionGroups.Any(group =>
                                group.IsActive &&
                                (
                                    EF.Functions.ILike(group.Name, searchPattern) ||
                                    group.Options.Any(option =>
                                        option.IsAvailable &&
                                        EF.Functions.ILike(option.Name, searchPattern))
                                ))))
                    .OrderBy(item => item.DisplayOrder)
                    .ThenBy(item => item.Name)
                    .Select(item => new PublicMenuItemResponse
                    {
                        Id = item.Id,
                        CategoryId = item.CategoryId,
                        Name = item.Name,
                        Description = item.Description,
                        Price = item.Price,
                        ImageUrl = item.ImageUrl,
                        IsAvailable = item.IsAvailable,
                        IsSoldOut = item.IsSoldOut,
                        DisplayOrder = item.DisplayOrder,
                        OptionGroups = item.OptionGroups
                            .Where(group => group.IsActive)
                            .OrderBy(group => group.DisplayOrder)
                            .ThenBy(group => group.Name)
                            .Select(group => new MenuOptionGroupResponse
                            {
                                Id = group.Id,
                                MenuItemId = group.MenuItemId,
                                Name = group.Name,
                                IsRequired = group.IsRequired,
                                MinSelections = group.MinSelections,
                                MaxSelections = group.MaxSelections,
                                DisplayOrder = group.DisplayOrder,
                                IsActive = group.IsActive,
                                CreatedAt = group.CreatedAt,
                                UpdatedAt = group.UpdatedAt,
                                Options = group.Options
                                    .Where(option => option.IsAvailable)
                                    .OrderBy(option => option.DisplayOrder)
                                    .ThenBy(option => option.Name)
                                    .Select(option => new MenuOptionResponse
                                    {
                                        Id = option.Id,
                                        GroupId = option.GroupId,
                                        Name = option.Name,
                                        PriceAdjustment = option.PriceAdjustment,
                                        AdjustmentType = (int)option.AdjustmentType,
                                        MaxQuantity = option.MaxQuantity,
                                        DisplayOrder = option.DisplayOrder,
                                        IsAvailable = option.IsAvailable,
                                        CreatedAt = option.CreatedAt,
                                        UpdatedAt = option.UpdatedAt
                                    })
                                    .ToList()
                            })
                            .ToList()
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        return Ok(new PublicMenuResponse
        {
            RestaurantId = restaurantId,
            Categories = categories
        });
    }
}
