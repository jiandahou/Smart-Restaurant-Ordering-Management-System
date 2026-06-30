using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Services;
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
public class TableController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly ReportLogWriter _reportLogWriter;

    public TableController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _reportLogWriter = reportLogWriter;
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("restaurant/{restaurantId:guid}")]
    public async Task<IActionResult> GetRestaurantTables(Guid restaurantId)
    {
        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        var restaurantExists = await _dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(restaurant => restaurant.Id == restaurantId);

        if (!restaurantExists)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var tables = await _dbContext.RestaurantTables
            .AsNoTracking()
            .Where(table => table.RestaurantId == restaurantId)
            .OrderBy(table => table.TableNumber)
            .ToListAsync();

        return Ok(tables.Select(MapToResponse).ToList());
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("restaurant/{restaurantId:guid}")]
    public async Task<IActionResult> CreateRestaurantTable(
        Guid restaurantId,
        [FromBody] UpdateRestaurantTableRequest request)
    {
        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        var restaurantExists = await _dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(restaurant => restaurant.Id == restaurantId);

        if (!restaurantExists)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var tableNumber = request.TableNumber.Trim();

        if (await TableNumberExistsAsync(restaurantId, tableNumber))
        {
            return Conflict(new { message = "A table with this number already exists in the restaurant." });
        }

        var table = new RestaurantTable
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            TableNumber = tableNumber,
            QrToken = await GenerateUniqueQrTokenAsync(),
            Capacity = request.Capacity,
            IsActive = request.IsActive,
            CreatedAt = DateTime.UtcNow
        };

        await _dbContext.RestaurantTables.AddAsync(table);
        _reportLogWriter.AddAudit(
            "RestaurantTable.Created",
            "RestaurantTable",
            table.Id.ToString(),
            table.RestaurantId,
            $"Created table {table.TableNumber}.",
            after: SnapshotTable(table));
        await _dbContext.SaveChangesAsync();

        return CreatedAtAction(
            nameof(GetRestaurantTables),
            new { restaurantId },
            new
            {
                message = "Restaurant table created successfully.",
                table = MapToResponse(table)
            });
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateRestaurantTable(
        Guid id,
        [FromBody] UpdateRestaurantTableRequest request)
    {
        var table = await _dbContext.RestaurantTables.FirstOrDefaultAsync(item => item.Id == id);

        if (table is null)
        {
            return NotFound(new { message = "Restaurant table not found." });
        }

        if (!await CanAccessRestaurantAsync(table.RestaurantId))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var tableNumber = request.TableNumber.Trim();
        if (await TableNumberExistsAsync(table.RestaurantId, tableNumber, table.Id))
        {
            return Conflict(new { message = "A table with this number already exists in the restaurant." });
        }

        var beforeTable = SnapshotTable(table);

        table.TableNumber = tableNumber;
        table.Capacity = request.Capacity;
        table.IsActive = request.IsActive;
        table.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "RestaurantTable.Updated",
            "RestaurantTable",
            table.Id.ToString(),
            table.RestaurantId,
            $"Updated table {table.TableNumber}.",
            beforeTable,
            SnapshotTable(table));
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Restaurant table updated successfully.",
            table = MapToResponse(table)
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

    private async Task<bool> TableNumberExistsAsync(Guid restaurantId, string tableNumber, Guid? excludedTableId = null)
    {
        var normalizedTableNumber = tableNumber.Trim().ToLower();
        return await _dbContext.RestaurantTables.AnyAsync(item =>
            item.RestaurantId == restaurantId &&
            (!excludedTableId.HasValue || item.Id != excludedTableId.Value) &&
            item.TableNumber.ToLower() == normalizedTableNumber);
    }

    private async Task<string> GenerateUniqueQrTokenAsync()
    {
        string token;

        do
        {
            token = RestaurantTableTokenGenerator.Generate();
        }
        while (await _dbContext.RestaurantTables.AnyAsync(table => table.QrToken == token));

        return token;
    }

    private static string? ValidateRequest(UpdateRestaurantTableRequest? request)
    {
        if (request is null)
        {
            return "Restaurant table data is required.";
        }

        if (string.IsNullOrWhiteSpace(request.TableNumber))
        {
            return "Table number is required.";
        }

        if (request.TableNumber.Trim().Length > 40)
        {
            return "Table number must not exceed 40 characters.";
        }

        if (request.Capacity < 1 || request.Capacity > 100)
        {
            return "Table capacity must be between 1 and 100.";
        }

        return null;
    }

    private static TableResponse MapToResponse(RestaurantTable table)
    {
        return new TableResponse
        {
            Id = table.Id,
            RestaurantId = table.RestaurantId,
            TableNumber = table.TableNumber,
            QrToken = string.IsNullOrWhiteSpace(table.QrToken) ? null : table.QrToken,
            Capacity = table.Capacity,
            IsActive = table.IsActive,
            CreatedAt = table.CreatedAt,
            UpdatedAt = table.UpdatedAt
        };
    }

    private static object SnapshotTable(RestaurantTable table) => new
    {
        table.Id,
        table.RestaurantId,
        table.TableNumber,
        table.Capacity,
        table.IsActive,
        QrTokenPresent = !string.IsNullOrWhiteSpace(table.QrToken)
    };
}
