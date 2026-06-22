using DineFlow.Api.Contracts.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class MenuController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public MenuController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// List all active categories for a restaurant.
    /// GET /api/menu/categories?restaurantId={id}
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories([FromQuery] Guid restaurantId)
    {
        if (restaurantId == Guid.Empty)
            return BadRequest(new { message = "restaurantId is required." });

        var categories = await _dbContext.MenuCategories
            .Where(c => c.RestaurantId == restaurantId && c.IsActive)
            .OrderBy(c => c.DisplayOrder)
            .ThenBy(c => c.Name)
            .Select(c => new MenuCategoryResponse
            {
                Id = c.Id,
                RestaurantId = c.RestaurantId,
                Name = c.Name,
                Description = c.Description,
                DisplayOrder = c.DisplayOrder,
                IsActive = c.IsActive,
                CreatedAt = c.CreatedAt,
                UpdatedAt = c.UpdatedAt
            })
            .ToListAsync();

        return Ok(categories);
    }

    /// <summary>
    /// List menu items for a restaurant, optionally filtered by category.
    /// GET /api/menu/items?restaurantId={id}&categoryId={id}
    /// </summary>
    [HttpGet("items")]
    public async Task<IActionResult> GetItems([FromQuery] Guid restaurantId, [FromQuery] Guid? categoryId)
    {
        if (restaurantId == Guid.Empty)
            return BadRequest(new { message = "restaurantId is required." });

        var query = _dbContext.MenuItems
            .Include(i => i.Category)
            .Include(i => i.OptionGroups.Where(g => g.IsActive))
                .ThenInclude(g => g.Options.Where(o => o.IsAvailable))
            .Where(i => i.RestaurantId == restaurantId && i.IsAvailable);

        if (categoryId.HasValue && categoryId.Value != Guid.Empty)
            query = query.Where(i => i.CategoryId == categoryId.Value);

        var items = await query
            .OrderBy(i => i.DisplayOrder)
            .ThenBy(i => i.Name)
            .ToListAsync();

        return Ok(items.Select(MapItem));
    }

    /// <summary>
    /// Search menu items by name or description.
    /// GET /api/menu/items/search?restaurantId={id}&q={query}
    /// </summary>
    [HttpGet("items/search")]
    public async Task<IActionResult> SearchItems([FromQuery] Guid restaurantId, [FromQuery] string q)
    {
        if (restaurantId == Guid.Empty)
            return BadRequest(new { message = "restaurantId is required." });

        if (string.IsNullOrWhiteSpace(q))
            return BadRequest(new { message = "Search query 'q' is required." });

        var term = q.Trim().ToLower();

        var items = await _dbContext.MenuItems
            .Include(i => i.Category)
            .Include(i => i.OptionGroups.Where(g => g.IsActive))
                .ThenInclude(g => g.Options.Where(o => o.IsAvailable))
            .Where(i =>
                i.RestaurantId == restaurantId &&
                i.IsAvailable &&
                (i.Name.ToLower().Contains(term) || (i.Description != null && i.Description.ToLower().Contains(term))))
            .OrderBy(i => i.DisplayOrder)
            .ThenBy(i => i.Name)
            .ToListAsync();

        return Ok(items.Select(MapItem));
    }

    private static MenuItemResponse MapItem(Infrastructure.Menu.MenuItem i) => new()
    {
        Id = i.Id,
        RestaurantId = i.RestaurantId,
        CategoryId = i.CategoryId,
        CategoryName = i.Category?.Name ?? string.Empty,
        Name = i.Name,
        Description = i.Description,
        Price = i.Price,
        ImageUrl = i.ImageUrl,
        IsAvailable = i.IsAvailable,
        IsSoldOut = i.IsSoldOut,
        IsVegetarian = i.IsVegetarian,
        IsVegan = i.IsVegan,
        IsGlutenFree = i.IsGlutenFree,
        IsHalal = i.IsHalal,
        Allergens = i.Allergens,
        DisplayOrder = i.DisplayOrder,
        CreatedAt = i.CreatedAt,
        UpdatedAt = i.UpdatedAt,
        OptionGroups = i.OptionGroups
            .OrderBy(g => g.DisplayOrder)
            .Select(g => new MenuOptionGroupResponse
            {
                Id = g.Id,
                MenuItemId = g.MenuItemId,
                Name = g.Name,
                IsRequired = g.IsRequired,
                MinSelections = g.MinSelections,
                MaxSelections = g.MaxSelections,
                DisplayOrder = g.DisplayOrder,
                IsActive = g.IsActive,
                CreatedAt = g.CreatedAt,
                UpdatedAt = g.UpdatedAt,
                Options = g.Options.OrderBy(o => o.DisplayOrder).Select(o => new MenuOptionResponse
                {
                    Id = o.Id,
                    GroupId = o.GroupId,
                    Name = o.Name,
                    PriceAdjustment = o.PriceAdjustment,
                    AdjustmentType = (int)o.AdjustmentType,
                    DisplayOrder = o.DisplayOrder,
                    IsAvailable = o.IsAvailable,
                    CreatedAt = o.CreatedAt,
                    UpdatedAt = o.UpdatedAt
                }).ToList()
            }).ToList()
    };
}
