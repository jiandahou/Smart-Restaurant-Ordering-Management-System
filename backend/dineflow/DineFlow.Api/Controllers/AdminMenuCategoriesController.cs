using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Menu;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/admin/menu/categories")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class AdminMenuCategoriesController : ControllerBase
{
    private const int MaximumNameLength = 100;
    private const int MaximumDescriptionLength = 500;
    private const int MaximumDisplayOrder = 10_000;

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;

    public AdminMenuCategoriesController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager)
    {
        _dbContext = dbContext;
        _userManager = userManager;
    }

    [HttpGet]
    public async Task<IActionResult> GetCategories(
        [FromQuery] Guid restaurantId,
        CancellationToken cancellationToken)
    {
        if (restaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "restaurantId is required." });
        }

        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        var restaurantExists = await _dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(restaurant => restaurant.Id == restaurantId, cancellationToken);

        if (!restaurantExists)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var categories = await _dbContext.MenuCategories
            .AsNoTracking()
            .Where(category => category.RestaurantId == restaurantId)
            .OrderBy(category => category.DisplayOrder)
            .ThenBy(category => category.Name)
            .Select(category => new MenuCategoryResponse
            {
                Id = category.Id,
                RestaurantId = category.RestaurantId,
                Name = category.Name,
                Description = category.Description,
                DisplayOrder = category.DisplayOrder,
                IsActive = category.IsActive,
                CreatedAt = category.CreatedAt,
                UpdatedAt = category.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        return Ok(categories);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetCategory(Guid id, CancellationToken cancellationToken)
    {
        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (category is null)
        {
            return NotFound(new { message = "Menu category not found." });
        }

        if (!await CanAccessRestaurantAsync(category.RestaurantId))
        {
            return Forbid();
        }

        return Ok(MapToResponse(category));
    }

    [HttpPost]
    public async Task<IActionResult> CreateCategory(
        [FromBody] CreateMenuCategoryRequest request,
        CancellationToken cancellationToken)
    {
        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "Restaurant is required." });
        }

        if (!await CanAccessRestaurantAsync(request.RestaurantId))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(
            request.Name,
            request.Description,
            request.DisplayOrder);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var restaurantExists = await _dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(restaurant => restaurant.Id == request.RestaurantId, cancellationToken);

        if (!restaurantExists)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var name = request.Name.Trim();

        if (await CategoryNameExistsAsync(request.RestaurantId, name, null, cancellationToken))
        {
            return Conflict(new { message = "A category with this name already exists in the restaurant." });
        }

        var category = new MenuCategory
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            Name = name,
            Description = NormalizeDescription(request.Description),
            DisplayOrder = request.DisplayOrder,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow
        };

        await _dbContext.MenuCategories.AddAsync(category, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(
            nameof(GetCategory),
            new { id = category.Id },
            new
            {
                message = "Menu category created successfully.",
                category = MapToResponse(category)
            });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateCategory(
        Guid id,
        [FromBody] UpdateMenuCategoryRequest request,
        CancellationToken cancellationToken)
    {
        var category = await _dbContext.MenuCategories
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (category is null)
        {
            return NotFound(new { message = "Menu category not found." });
        }

        if (!await CanAccessRestaurantAsync(category.RestaurantId))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(
            request.Name,
            request.Description,
            request.DisplayOrder);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var name = request.Name.Trim();

        if (await CategoryNameExistsAsync(category.RestaurantId, name, category.Id, cancellationToken))
        {
            return Conflict(new { message = "A category with this name already exists in the restaurant." });
        }

        category.Name = name;
        category.Description = NormalizeDescription(request.Description);
        category.DisplayOrder = request.DisplayOrder;
        category.IsActive = request.IsActive;
        category.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Menu category updated successfully.",
            category = MapToResponse(category)
        });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteCategory(Guid id, CancellationToken cancellationToken)
    {
        var category = await _dbContext.MenuCategories
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (category is null)
        {
            return NotFound(new { message = "Menu category not found." });
        }

        if (!await CanAccessRestaurantAsync(category.RestaurantId))
        {
            return Forbid();
        }

        var containsItems = await _dbContext.MenuItems
            .AsNoTracking()
            .AnyAsync(item => item.CategoryId == id, cancellationToken);

        if (containsItems)
        {
            return Conflict(new
            {
                message = "This category contains menu items. Move or delete those items before deleting the category."
            });
        }

        _dbContext.MenuCategories.Remove(category);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Menu category deleted successfully.",
            categoryId = id
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

    private async Task<bool> CategoryNameExistsAsync(
        Guid restaurantId,
        string name,
        Guid? excludedCategoryId,
        CancellationToken cancellationToken)
    {
        var normalizedName = name.ToLower();

        return await _dbContext.MenuCategories.AnyAsync(category =>
            category.RestaurantId == restaurantId &&
            (!excludedCategoryId.HasValue || category.Id != excludedCategoryId.Value) &&
            category.Name.ToLower() == normalizedName,
            cancellationToken);
    }

    private static string? ValidateRequest(string? name, string? description, int displayOrder)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return "Category name is required.";
        }

        if (name.Trim().Length > MaximumNameLength)
        {
            return $"Category name must not exceed {MaximumNameLength} characters.";
        }

        if (description?.Trim().Length > MaximumDescriptionLength)
        {
            return $"Category description must not exceed {MaximumDescriptionLength} characters.";
        }

        if (displayOrder < 0 || displayOrder > MaximumDisplayOrder)
        {
            return $"Display order must be between 0 and {MaximumDisplayOrder}.";
        }

        return null;
    }

    private static string? NormalizeDescription(string? description)
    {
        return string.IsNullOrWhiteSpace(description) ? null : description.Trim();
    }

    private static MenuCategoryResponse MapToResponse(MenuCategory category)
    {
        return new MenuCategoryResponse
        {
            Id = category.Id,
            RestaurantId = category.RestaurantId,
            Name = category.Name,
            Description = category.Description,
            DisplayOrder = category.DisplayOrder,
            IsActive = category.IsActive,
            CreatedAt = category.CreatedAt,
            UpdatedAt = category.UpdatedAt
        };
    }
}
