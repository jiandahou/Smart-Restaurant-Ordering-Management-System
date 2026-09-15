using System.Security.Claims;
using DineFlow.Api.Contracts.Privacy;
using DineFlow.Application.Authorization;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/privacy")]
public sealed class PrivacyController(AppDbContext dbContext, ReportLogWriter reportLogWriter) : ControllerBase
{
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
        { "Access", "Correction", "Deletion", "Complaint" };

    [HttpPost("requests")]
    public async Task<ActionResult<PrivacyRequestResponse>> Create(
        CreatePrivacyRequest request,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        var requestType = request.RequestType.Trim();
        var details = request.Details.Trim();
        if (!AllowedTypes.Contains(requestType))
            return BadRequest(new { message = "RequestType must be Access, Correction, Deletion, or Complaint." });
        if (details.Length is < 10 or > 4000)
            return BadRequest(new { message = "Details must be between 10 and 4,000 characters." });

        var entity = new PrivacyRequest { UserId = userId, RequestType = requestType, Details = details };
        dbContext.PrivacyRequests.Add(entity);
        reportLogWriter.AddAudit("Privacy.RequestCreated", "PrivacyRequest", entity.Id.ToString(), null,
            $"{requestType} privacy request received.", after: new { entity.RequestType, entity.Status });
        await dbContext.SaveChangesAsync(cancellationToken);
        return CreatedAtAction(nameof(GetMine), new { }, Map(entity));
    }

    [HttpGet("requests/mine")]
    public async Task<ActionResult<IReadOnlyList<PrivacyRequestResponse>>> GetMine(CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId)) return Unauthorized();
        var requests = await dbContext.PrivacyRequests.AsNoTracking()
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(requests.Select(Map).ToList());
    }

    /// <summary>
    /// Every privacy request on the platform, oldest clock first.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Platform owner only, and deliberately not scoped to a restaurant: a request concerns a
    /// person's information across the whole platform, not one venue's copy of it, and the entity
    /// carries no restaurant for that reason.
    /// </para>
    /// <para>
    /// Nothing showed these to anyone. A customer could file a request and it landed in a table with
    /// no screen behind it — which under the Privacy Act is not an oversight but a missed deadline,
    /// counting from the day they asked.
    /// </para>
    /// </remarks>
    [Authorize(Roles = ApplicationRoles.PlatformOwner)]
    [HttpGet("requests")]
    public async Task<ActionResult<IReadOnlyList<AdminPrivacyRequestResponse>>> GetAll(
        [FromQuery] bool openOnly,
        CancellationToken cancellationToken)
    {
        var requests = await dbContext.PrivacyRequests
            .AsNoTracking()
            .Include(item => item.User)
            .OrderBy(item => item.CompletedAt.HasValue)
            .ThenBy(item => item.CreatedAt)
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var mapped = requests
            .Where(item => !openOnly || !PrivacyRequestWorkflow.IsClosed(item.Status))
            .Select(item => MapForAdmin(item, now))
            .ToList();

        return Ok(mapped);
    }

    /// <summary>Moves a request along, and records who moved it and why.</summary>
    [Authorize(Roles = ApplicationRoles.PlatformOwner)]
    [HttpPost("requests/{id:guid}/status")]
    public async Task<ActionResult<AdminPrivacyRequestResponse>> UpdateStatus(
        Guid id,
        UpdatePrivacyRequestStatusRequest request,
        CancellationToken cancellationToken)
    {
        var entity = await dbContext.PrivacyRequests
            .Include(item => item.User)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { message = "Privacy request not found." });
        }

        var next = request.Status?.Trim() ?? string.Empty;
        var refusal = PrivacyRequestWorkflow.Refuse(entity.Status, next);
        if (refusal is not null)
        {
            return Conflict(new { message = refusal });
        }

        var note = request.Note?.Trim();
        // Declining someone's request about their own information is the one move that has to carry
        // a reason: it is what the person is owed, and what an investigation would ask for first.
        if (string.Equals(next, PrivacyRequestWorkflow.Declined, StringComparison.Ordinal)
            && string.IsNullOrWhiteSpace(note))
        {
            return BadRequest(new { message = "A reason is required to decline a privacy request." });
        }

        var previous = entity.Status;
        var now = DateTime.UtcNow;
        entity.Status = next;
        entity.UpdatedAt = now;
        entity.CompletedAt = PrivacyRequestWorkflow.IsClosed(next) ? now : null;

        reportLogWriter.AddAudit(
            "Privacy.RequestStatusChanged",
            "PrivacyRequest",
            entity.Id.ToString(),
            null,
            $"{entity.RequestType} privacy request moved from {previous} to {next}.",
            after: new
            {
                entity.RequestType,
                previousStatus = previous,
                status = entity.Status,
                note,
                daysOpen = (int)Math.Floor((now - entity.CreatedAt).TotalDays)
            });

        await dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapForAdmin(entity, now));
    }

    private static AdminPrivacyRequestResponse MapForAdmin(PrivacyRequest item, DateTime now) => new()
    {
        Id = item.Id,
        RequestType = item.RequestType,
        Details = item.Details,
        Status = item.Status,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
        CompletedAt = item.CompletedAt,
        RequesterEmail = item.User?.Email,
        RequesterName = item.User?.FullName,
        DaysRemaining = PrivacyRequestWorkflow.DaysRemaining(item.Status, item.CreatedAt, now),
        IsOverdue = PrivacyRequestWorkflow.IsOverdue(item.Status, item.CreatedAt, now)
    };

    private static PrivacyRequestResponse Map(PrivacyRequest item) => new()
    {
        Id = item.Id, RequestType = item.RequestType, Details = item.Details, Status = item.Status,
        CreatedAt = item.CreatedAt, UpdatedAt = item.UpdatedAt, CompletedAt = item.CompletedAt
    };
}
