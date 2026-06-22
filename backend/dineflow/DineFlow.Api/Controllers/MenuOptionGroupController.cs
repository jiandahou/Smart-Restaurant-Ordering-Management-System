using DineFlow.Api.Contracts.Menu;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/menu/items/{itemId:guid}/option-groups")]
[Authorize(Roles = "PlatformOwner,RestaurantOwner,Admin")]
public class MenuOptionGroupController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ILogger<MenuOptionGroupController> _logger;

    public MenuOptionGroupController(AppDbContext db, ILogger<MenuOptionGroupController> logger)
    {
        _db = db;
        _logger = logger;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static MenuOptionGroupResponse MapGroup(MenuItemOptionGroup g) => new()
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
        Options = g.Options.OrderBy(o => o.DisplayOrder).Select(MapOption).ToList()
    };

    private static MenuOptionResponse MapOption(MenuItemOption o) => new()
    {
        Id = o.Id,
        GroupId = o.GroupId,
        Name = o.Name,
        PriceAdjustment = o.PriceAdjustment,
        AdjustmentType = (int)o.AdjustmentType,
        MaxQuantity = o.MaxQuantity,
        DisplayOrder = o.DisplayOrder,
        IsAvailable = o.IsAvailable,
        CreatedAt = o.CreatedAt,
        UpdatedAt = o.UpdatedAt
    };

    private async Task<MenuItem?> LoadItemForTenantAsync(Guid itemId)
    {
        // Resolve restaurant from the authenticated user's claims
        var restaurantClaim = User.FindFirst("RestaurantId")?.Value;
        var isPlatformOwner = User.IsInRole("PlatformOwner");

        var query = _db.MenuItems.Where(m => m.Id == itemId);
        if (!isPlatformOwner && Guid.TryParse(restaurantClaim, out var restaurantId))
            query = query.Where(m => m.RestaurantId == restaurantId);

        return await query.FirstOrDefaultAsync();
    }

    // ── option group endpoints ───────────────────────────────────────────────

    [HttpGet]
    public async Task<IActionResult> ListGroups(Guid itemId)
    {
        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return NotFound(new { message = "Menu item not found." });

        var groups = await _db.MenuItemOptionGroups
            .Include(g => g.Options)
            .Where(g => g.MenuItemId == itemId)
            .OrderBy(g => g.DisplayOrder)
            .ToListAsync();

        return Ok(groups.Select(MapGroup));
    }

    [HttpPost]
    public async Task<IActionResult> CreateGroup(Guid itemId, [FromBody] CreateMenuOptionGroupRequest request)
    {
        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return NotFound(new { message = "Menu item not found." });

        if (request.MaxSelections < 1)
            return BadRequest(new { message = "MaxSelections must be at least 1." });

        if (request.IsRequired && request.MinSelections < 1)
            return BadRequest(new { message = "Required groups must have MinSelections >= 1." });

        if (request.MinSelections > request.MaxSelections)
            return BadRequest(new { message = "MinSelections cannot exceed MaxSelections." });

        var group = new MenuItemOptionGroup
        {
            MenuItemId = itemId,
            RestaurantId = item.RestaurantId,
            Name = request.Name,
            IsRequired = request.IsRequired,
            MinSelections = request.MinSelections,
            MaxSelections = request.MaxSelections,
            DisplayOrder = request.DisplayOrder
        };

        _db.MenuItemOptionGroups.Add(group);
        await _db.SaveChangesAsync();

        group.Options = [];
        return CreatedAtAction(nameof(ListGroups), new { itemId }, MapGroup(group));
    }

    [HttpPut("{groupId:guid}")]
    public async Task<IActionResult> UpdateGroup(Guid itemId, Guid groupId, [FromBody] UpdateMenuOptionGroupRequest request)
    {
        var group = await _db.MenuItemOptionGroups
            .Include(g => g.Options)
            .FirstOrDefaultAsync(g => g.Id == groupId && g.MenuItemId == itemId);

        if (group is null) return NotFound(new { message = "Option group not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        if (request.MaxSelections < 1)
            return BadRequest(new { message = "MaxSelections must be at least 1." });

        if (request.IsRequired && request.MinSelections < 1)
            return BadRequest(new { message = "Required groups must have MinSelections >= 1." });

        if (request.MinSelections > request.MaxSelections)
            return BadRequest(new { message = "MinSelections cannot exceed MaxSelections." });

        group.Name = request.Name;
        group.IsRequired = request.IsRequired;
        group.MinSelections = request.MinSelections;
        group.MaxSelections = request.MaxSelections;
        group.DisplayOrder = request.DisplayOrder;
        group.IsActive = request.IsActive;
        group.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(MapGroup(group));
    }

    [HttpPost("{groupId:guid}/archive")]
    public async Task<IActionResult> ArchiveGroup(Guid itemId, Guid groupId)
    {
        var group = await _db.MenuItemOptionGroups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.MenuItemId == itemId);

        if (group is null) return NotFound(new { message = "Option group not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        group.IsActive = false;
        group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ── option endpoints ─────────────────────────────────────────────────────

    [HttpGet("{groupId:guid}/options")]
    public async Task<IActionResult> ListOptions(Guid itemId, Guid groupId)
    {
        var group = await _db.MenuItemOptionGroups
            .Include(g => g.Options)
            .FirstOrDefaultAsync(g => g.Id == groupId && g.MenuItemId == itemId);

        if (group is null) return NotFound(new { message = "Option group not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        return Ok(group.Options.OrderBy(o => o.DisplayOrder).Select(MapOption));
    }

    [HttpPost("{groupId:guid}/options")]
    public async Task<IActionResult> CreateOption(Guid itemId, Guid groupId, [FromBody] CreateMenuOptionRequest request)
    {
        var group = await _db.MenuItemOptionGroups
            .FirstOrDefaultAsync(g => g.Id == groupId && g.MenuItemId == itemId);

        if (group is null) return NotFound(new { message = "Option group not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        var adjustmentType = (OptionAdjustmentType)request.AdjustmentType;

        // Remove type must have non-positive adjustment; Add/Replace must be non-negative
        if (adjustmentType == OptionAdjustmentType.Remove && request.PriceAdjustment > 0)
            return BadRequest(new { message = "Remove adjustments must be zero or negative." });

        if (adjustmentType != OptionAdjustmentType.Remove && request.PriceAdjustment < 0)
            return BadRequest(new { message = "Add/Replace adjustments must be zero or positive." });

        if (request.MaxQuantity < 1)
            return BadRequest(new { message = "MaxQuantity must be at least 1." });

        var option = new MenuItemOption
        {
            GroupId = groupId,
            MenuItemId = itemId,
            RestaurantId = item.RestaurantId,
            Name = request.Name,
            PriceAdjustment = request.PriceAdjustment,
            AdjustmentType = adjustmentType,
            MaxQuantity = request.MaxQuantity,
            DisplayOrder = request.DisplayOrder
        };

        _db.MenuItemOptions.Add(option);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(ListOptions), new { itemId, groupId }, MapOption(option));
    }

    [HttpPut("{groupId:guid}/options/{optionId:guid}")]
    public async Task<IActionResult> UpdateOption(Guid itemId, Guid groupId, Guid optionId, [FromBody] UpdateMenuOptionRequest request)
    {
        var option = await _db.MenuItemOptions
            .FirstOrDefaultAsync(o => o.Id == optionId && o.GroupId == groupId && o.MenuItemId == itemId);

        if (option is null) return NotFound(new { message = "Option not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        var adjustmentType = (OptionAdjustmentType)request.AdjustmentType;

        if (adjustmentType == OptionAdjustmentType.Remove && request.PriceAdjustment > 0)
            return BadRequest(new { message = "Remove adjustments must be zero or negative." });

        if (adjustmentType != OptionAdjustmentType.Remove && request.PriceAdjustment < 0)
            return BadRequest(new { message = "Add/Replace adjustments must be zero or positive." });

        if (request.MaxQuantity < 1)
            return BadRequest(new { message = "MaxQuantity must be at least 1." });

        option.Name = request.Name;
        option.PriceAdjustment = request.PriceAdjustment;
        option.AdjustmentType = adjustmentType;
        option.MaxQuantity = request.MaxQuantity;
        option.DisplayOrder = request.DisplayOrder;
        option.IsAvailable = request.IsAvailable;
        option.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(MapOption(option));
    }

    [HttpPost("{groupId:guid}/options/{optionId:guid}/archive")]
    public async Task<IActionResult> ArchiveOption(Guid itemId, Guid groupId, Guid optionId)
    {
        var option = await _db.MenuItemOptions
            .FirstOrDefaultAsync(o => o.Id == optionId && o.GroupId == groupId && o.MenuItemId == itemId);

        if (option is null) return NotFound(new { message = "Option not found." });

        var item = await LoadItemForTenantAsync(itemId);
        if (item is null) return Forbid();

        option.IsAvailable = false;
        option.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return NoContent();
    }
}
