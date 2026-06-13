using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TableController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public TableController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Resolve a table from its QR token. Called when customer scans a QR code.
    /// GET /api/table/resolve?token={qrToken}
    /// </summary>
    [HttpGet("resolve")]
    public async Task<IActionResult> ResolveByQrToken([FromQuery] string token)
    {
        if (string.IsNullOrWhiteSpace(token))
            return BadRequest(new { message = "QR token is required." });

        var table = await _dbContext.RestaurantTables
            .FirstOrDefaultAsync(t => t.QrCodeToken == token && t.IsActive);

        if (table is null)
            return NotFound(new { message = "Table not found or QR code is invalid." });

        return Ok(new TableResponse
        {
            Id = table.Id,
            RestaurantId = table.RestaurantId,
            TableNumber = table.TableNumber,
            Capacity = table.Capacity,
            IsActive = table.IsActive
        });
    }
}
