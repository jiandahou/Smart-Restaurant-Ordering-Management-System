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
            .Where(i => i.RestaurantId == restaurantId && i.IsAvailable);

        if (categoryId.HasValue && categoryId.Value != Guid.Empty)
            query = query.Where(i => i.CategoryId == categoryId.Value);

        var items = await query
            .OrderBy(i => i.DisplayOrder)
            .ThenBy(i => i.Name)
            .Select(i => new MenuItemResponse
            {
                Id = i.Id,
                RestaurantId = i.RestaurantId,
                CategoryId = i.CategoryId,
                CategoryName = i.Category != null ? i.Category.Name : string.Empty,
                Name = i.Name,
                Description = i.Description,
                Price = i.Price,
                ImageUrl = i.ImageUrl,
                IsAvailable = i.IsAvailable,
                IsSoldOut = i.IsSoldOut,
                DisplayOrder = i.DisplayOrder,
                CreatedAt = i.CreatedAt,
                UpdatedAt = i.UpdatedAt
            })
            .ToListAsync();

        return Ok(items);
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
            .Where(i =>
                i.RestaurantId == restaurantId &&
                i.IsAvailable &&
                (i.Name.ToLower().Contains(term) || (i.Description != null && i.Description.ToLower().Contains(term))))
            .OrderBy(i => i.DisplayOrder)
            .ThenBy(i => i.Name)
            .Select(i => new MenuItemResponse
            {
                Id = i.Id,
                RestaurantId = i.RestaurantId,
                CategoryId = i.CategoryId,
                CategoryName = i.Category != null ? i.Category.Name : string.Empty,
                Name = i.Name,
                Description = i.Description,
                Price = i.Price,
                ImageUrl = i.ImageUrl,
                IsAvailable = i.IsAvailable,
                IsSoldOut = i.IsSoldOut,
                DisplayOrder = i.DisplayOrder,
                CreatedAt = i.CreatedAt,
                UpdatedAt = i.UpdatedAt
            })
            .ToListAsync();

        return Ok(items);
    }
}
