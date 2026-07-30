using System.Security.Claims;
using System.Text;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Reports;
using DineFlow.Api.Extensions;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/admin/reports")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class AdminReportsController : ControllerBase
{
    private const int MaxExportRows = 5_000;

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AdminActivityReportService _activityReportService;

    public AdminReportsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        AdminActivityReportService activityReportService)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _activityReportService = activityReportService;
    }

    [HttpGet("activity")]
    public async Task<ActionResult<PagedResponse<ActivityLogResponse>>> GetActivity(
        [FromQuery] ActivityLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        var isPlatformOwner = User.IsInRole(ApplicationRoles.PlatformOwner);
        if (!isPlatformOwner && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        return Ok(await _activityReportService.GetActivityAsync(
            request,
            currentRestaurantId,
            isPlatformOwner,
            includeTechnicalDetails: isPlatformOwner,
            cancellationToken));
    }

    [HttpGet("activity/summary")]
    public async Task<ActionResult<ActivitySummaryResponse>> GetActivitySummary(
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        var isPlatformOwner = User.IsInRole(ApplicationRoles.PlatformOwner);
        if (!isPlatformOwner && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        return Ok(await _activityReportService.GetSummaryAsync(
            restaurantId,
            currentRestaurantId,
            isPlatformOwner,
            cancellationToken));
    }

    [HttpGet("activity/export")]
    public async Task<IActionResult> ExportActivity(
        [FromQuery] ActivityLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        var isPlatformOwner = User.IsInRole(ApplicationRoles.PlatformOwner);
        if (!isPlatformOwner && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var rows = new List<ActivityLogResponse>();
        var page = 1;
        var totalItems = 0;
        do
        {
            request.Page = page;
            request.PageSize = 100;
            var result = await _activityReportService.GetActivityAsync(
                request,
                currentRestaurantId,
                isPlatformOwner,
                includeTechnicalDetails: isPlatformOwner,
                cancellationToken);
            totalItems = result.TotalItems;
            rows.AddRange(result.Items);
            page++;
        }
        while (rows.Count < Math.Min(totalItems, MaxExportRows));

        var truncated = totalItems > MaxExportRows;
        return BuildCsvFile(
            "activity-report.csv",
            [
                "OccurredAt",
                "Restaurant",
                "Category",
                "Outcome",
                "ActorType",
                "Actor",
                "Roles",
                "Source",
                "Action",
                "Description",
                "OrderNumber",
                "PaymentId",
                "Status",
                "AmountCents",
                "Currency",
                "CorrelationId",
                "TechnicalJson"
            ],
            rows.Take(MaxExportRows).Select(row => new object?[]
            {
                row.OccurredAt,
                row.RestaurantName,
                row.Category,
                row.Severity,
                row.ActorType,
                row.ActorName,
                row.ActorRoles,
                row.Source,
                row.ActionLabel,
                row.Description,
                row.OrderNumber,
                row.PaymentId,
                row.Status,
                row.AmountCents,
                row.Currency,
                row.CorrelationId,
                row.TechnicalJson
            }),
            truncated);
    }

    [HttpGet("policy")]
    public ActionResult<ReportPolicyResponse> GetReportPolicy() =>
        Ok(new ReportPolicyResponse
        {
            MaxExportRows = MaxExportRows,
            AuditRetentionDays = AdminActivityReportService.AuditRetentionDays,
            OrderEventRetentionDays = AdminActivityReportService.OrderEventRetentionDays,
            PaymentEventRetentionDays = AdminActivityReportService.PaymentEventRetentionDays,
            LogsAreImmutable = true,
            SensitiveTechnicalDetailsRequirePlatformOwner = true
        });

    [HttpGet("audit")]
    public async Task<ActionResult<PagedResponse<AuditLogResponse>>> GetAuditLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = _dbContext.AuditLogs.AsNoTracking().AsQueryable();
        query = ApplyTenantScope(query, currentRestaurantId, request.RestaurantId);
        query = ApplyAuditFilters(query, request);

        var sortedQuery = ApplyAuditSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "action", "entityType", "actorEmail" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);
        return Ok(new PagedResponse<AuditLogResponse>
        {
            Items = page.Items
                .Select(log => MapAuditLog(log, User.IsInRole(ApplicationRoles.PlatformOwner)))
                .ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [HttpGet("orders")]
    public async Task<ActionResult<PagedResponse<OrderEventLogResponse>>> GetOrderEventLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = _dbContext.OrderEventLogs.AsNoTracking().AsQueryable();
        query = ApplyTenantScope(query, currentRestaurantId, request.RestaurantId);
        query = ApplyOrderEventFilters(query, request);

        var sortedQuery = ApplyOrderEventSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "eventType", "orderNumber", "actorDisplayName" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);
        return Ok(new PagedResponse<OrderEventLogResponse>
        {
            Items = page.Items
                .Select(log => MapOrderEventLog(log, User.IsInRole(ApplicationRoles.PlatformOwner)))
                .ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [HttpGet("payments")]
    public async Task<ActionResult<PagedResponse<PaymentEventLogResponse>>> GetPaymentEventLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = _dbContext.PaymentEventLogs.AsNoTracking().AsQueryable();
        query = ApplyTenantScope(query, currentRestaurantId, request.RestaurantId);
        query = ApplyPaymentEventFilters(query, request);

        var sortedQuery = ApplyPaymentEventSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "eventType", "status", "orderNumber", "provider" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);
        return Ok(new PagedResponse<PaymentEventLogResponse>
        {
            Items = page.Items
                .Select(log => MapPaymentEventLog(log, User.IsInRole(ApplicationRoles.PlatformOwner)))
                .ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [HttpGet("audit/export")]
    public async Task<IActionResult> ExportAuditLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = ApplyAuditFilters(
            ApplyTenantScope(_dbContext.AuditLogs.AsNoTracking().AsQueryable(), currentRestaurantId, request.RestaurantId),
            request);
        var sortedQuery = ApplyAuditSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new { message = "Unsupported sortBy value." });
        }

        var exportRows = await sortedQuery.Take(MaxExportRows + 1).ToListAsync(cancellationToken);
        var truncated = exportRows.Count > MaxExportRows;
        var rows = exportRows.Take(MaxExportRows).ToList();
        var includeSensitiveDetails = User.IsInRole(ApplicationRoles.PlatformOwner);
        var headers = new List<string>
        {
            "CreatedAt",
            "Action",
            "ActorEmail",
            "ActorRoles",
            "ActorType",
            "Source",
            "CorrelationId",
            "EntityType",
            "EntityId",
            "RestaurantId",
            "Summary"
        };
        if (includeSensitiveDetails)
        {
            headers.Add("BeforeJson");
            headers.Add("AfterJson");
            headers.Add("IpAddress");
            headers.Add("UserAgent");
        }

        return BuildCsvFile(
            "audit-logs.csv",
            headers,
            rows.Select(log =>
            {
                var values = new List<object?>
                {
                    log.CreatedAt,
                    log.Action,
                    log.ActorEmail,
                    log.ActorRoles,
                    log.ActorType,
                    log.Source,
                    log.CorrelationId,
                    log.EntityType,
                    log.EntityId,
                    log.RestaurantId,
                    log.Summary
                };
                if (includeSensitiveDetails)
                {
                    values.Add(log.BeforeJson);
                    values.Add(log.AfterJson);
                    values.Add(log.IpAddress);
                    values.Add(log.UserAgent);
                }
                return values.ToArray();
            }),
            truncated);
    }

    [HttpGet("orders/export")]
    public async Task<IActionResult> ExportOrderEventLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = ApplyOrderEventFilters(
            ApplyTenantScope(_dbContext.OrderEventLogs.AsNoTracking().AsQueryable(), currentRestaurantId, request.RestaurantId),
            request);
        var sortedQuery = ApplyOrderEventSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new { message = "Unsupported sortBy value." });
        }

        var exportRows = await sortedQuery.Take(MaxExportRows + 1).ToListAsync(cancellationToken);
        var truncated = exportRows.Count > MaxExportRows;
        var rows = exportRows.Take(MaxExportRows).ToList();
        return BuildCsvFile(
            "order-event-logs.csv",
            [
                "CreatedAt",
                "EventType",
                "OrderNumber",
                "OrderId",
                "RestaurantId",
                "ActorDisplayName",
                "ActorRoles",
                "ActorType",
                "Source",
                "CorrelationId",
                "Message",
                "DataJson"
            ],
            rows.Select(log => new object?[]
            {
                log.CreatedAt,
                log.EventType,
                log.OrderNumber,
                log.OrderId,
                log.RestaurantId,
                log.ActorDisplayName,
                log.ActorRoles,
                log.ActorType,
                log.Source,
                log.CorrelationId,
                log.Message,
                User.IsInRole(ApplicationRoles.PlatformOwner) ? log.DataJson : null
            }),
            truncated);
    }

    [HttpGet("payments/export")]
    public async Task<IActionResult> ExportPaymentEventLogs(
        [FromQuery] ReportLogListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "Current user is not assigned to a restaurant." });
        }

        var query = ApplyPaymentEventFilters(
            ApplyTenantScope(_dbContext.PaymentEventLogs.AsNoTracking().AsQueryable(), currentRestaurantId, request.RestaurantId),
            request);
        var sortedQuery = ApplyPaymentEventSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new { message = "Unsupported sortBy value." });
        }

        var exportRows = await sortedQuery.Take(MaxExportRows + 1).ToListAsync(cancellationToken);
        var truncated = exportRows.Count > MaxExportRows;
        var rows = exportRows.Take(MaxExportRows).ToList();
        return BuildCsvFile(
            "payment-event-logs.csv",
            [
                "CreatedAt",
                "EventType",
                "Provider",
                "ProviderEventId",
                "Status",
                "OrderNumber",
                "OrderId",
                "PaymentId",
                "PaymentRefundId",
                "RestaurantId",
                "ActorDisplayName",
                "ActorRoles",
                "ActorType",
                "Source",
                "CorrelationId",
                "Message",
                "DataJson"
            ],
            rows.Select(log => new object?[]
            {
                log.CreatedAt,
                log.EventType,
                log.Provider,
                log.ProviderEventId,
                log.Status,
                log.OrderNumber,
                log.OrderId,
                log.PaymentId,
                log.PaymentRefundId,
                log.RestaurantId,
                log.ActorDisplayName,
                log.ActorRoles,
                log.ActorType,
                log.Source,
                log.CorrelationId,
                log.Message,
                User.IsInRole(ApplicationRoles.PlatformOwner) ? log.DataJson : null
            }),
            truncated);
    }

    private FileContentResult BuildCsvFile(
        string fileName,
        IReadOnlyList<string> headers,
        IEnumerable<object?[]> rows,
        bool truncated)
    {
        var builder = new StringBuilder();
        AppendCsvRow(builder, headers);

        foreach (var row in rows)
        {
            AppendCsvRow(builder, row);
        }

        var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true)
            .GetBytes(builder.ToString());

        Response.Headers["X-Export-Row-Limit"] = MaxExportRows.ToString();
        Response.Headers["X-Export-Truncated"] = truncated ? "true" : "false";
        return File(bytes, "text/csv; charset=utf-8", fileName);
    }

    private static void AppendCsvRow(StringBuilder builder, IEnumerable<object?> values)
    {
        builder.AppendLine(string.Join(",", values.Select(FormatCsvValue)));
    }

    private static string FormatCsvValue(object? value)
    {
        var text = value switch
        {
            null => string.Empty,
            DateTime dateTime => dateTime.ToString("O"),
            DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("O"),
            _ => value.ToString() ?? string.Empty
        };

        if (text.Length > 0 && text[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
        {
            text = $"'{text}";
        }

        return text.Contains('"') || text.Contains(',') || text.Contains('\n') || text.Contains('\r')
            ? $"\"{text.Replace("\"", "\"\"")}\""
            : text;
    }

    private IQueryable<AuditLog> ApplyTenantScope(
        IQueryable<AuditLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId)
    {
        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(log => log.RestaurantId == currentRestaurantId);
        }

        return requestedRestaurantId.HasValue
            ? query.Where(log => log.RestaurantId == requestedRestaurantId)
            : query;
    }

    private IQueryable<OrderEventLog> ApplyTenantScope(
        IQueryable<OrderEventLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId)
    {
        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(log => log.RestaurantId == currentRestaurantId);
        }

        return requestedRestaurantId.HasValue
            ? query.Where(log => log.RestaurantId == requestedRestaurantId)
            : query;
    }

    private IQueryable<PaymentEventLog> ApplyTenantScope(
        IQueryable<PaymentEventLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId)
    {
        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(log => log.RestaurantId == currentRestaurantId);
        }

        return requestedRestaurantId.HasValue
            ? query.Where(log => log.RestaurantId == requestedRestaurantId)
            : query;
    }

    private static IQueryable<AuditLog> ApplyAuditFilters(IQueryable<AuditLog> query, ReportLogListRequest request)
    {
        query = ApplyDateFilter(query, request.CreatedFrom, request.CreatedTo);

        if (!string.IsNullOrWhiteSpace(request.Action))
        {
            query = query.Where(log => log.Action == request.Action);
        }

        if (!string.IsNullOrWhiteSpace(request.EntityType))
        {
            query = query.Where(log => log.EntityType == request.EntityType);
        }

        if (!string.IsNullOrWhiteSpace(request.EntityId))
        {
            query = query.Where(log => log.EntityId == request.EntityId);
        }

        if (!string.IsNullOrWhiteSpace(request.ActorUserId))
        {
            query = query.Where(log => log.ActorUserId == request.ActorUserId);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.Action, pattern) ||
                EF.Functions.ILike(log.EntityType, pattern) ||
                (log.EntityId != null && EF.Functions.ILike(log.EntityId, pattern)) ||
                (log.Summary != null && EF.Functions.ILike(log.Summary, pattern)) ||
                (log.ActorEmail != null && EF.Functions.ILike(log.ActorEmail, pattern)));
        }

        return query;
    }

    private static IQueryable<OrderEventLog> ApplyOrderEventFilters(IQueryable<OrderEventLog> query, ReportLogListRequest request)
    {
        query = ApplyDateFilter(query, request.CreatedFrom, request.CreatedTo);

        if (!string.IsNullOrWhiteSpace(request.EventType))
        {
            query = query.Where(log => log.EventType == request.EventType);
        }

        if (request.OrderId.HasValue)
        {
            query = query.Where(log => log.OrderId == request.OrderId);
        }

        if (!string.IsNullOrWhiteSpace(request.ActorUserId))
        {
            query = query.Where(log => log.ActorUserId == request.ActorUserId);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.EventType, pattern) ||
                EF.Functions.ILike(log.Message, pattern) ||
                EF.Functions.ILike(log.OrderNumber, pattern) ||
                (log.ActorDisplayName != null && EF.Functions.ILike(log.ActorDisplayName, pattern)));
        }

        return query;
    }

    private static IQueryable<PaymentEventLog> ApplyPaymentEventFilters(IQueryable<PaymentEventLog> query, ReportLogListRequest request)
    {
        query = ApplyDateFilter(query, request.CreatedFrom, request.CreatedTo);

        if (!string.IsNullOrWhiteSpace(request.EventType))
        {
            query = query.Where(log => log.EventType == request.EventType);
        }

        if (request.OrderId.HasValue)
        {
            query = query.Where(log => log.OrderId == request.OrderId);
        }

        if (request.PaymentId.HasValue)
        {
            query = query.Where(log => log.PaymentId == request.PaymentId);
        }

        if (!string.IsNullOrWhiteSpace(request.ActorUserId))
        {
            query = query.Where(log => log.ActorUserId == request.ActorUserId);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.EventType, pattern) ||
                EF.Functions.ILike(log.Message, pattern) ||
                EF.Functions.ILike(log.Provider, pattern) ||
                (log.Status != null && EF.Functions.ILike(log.Status, pattern)) ||
                (log.OrderNumber != null && EF.Functions.ILike(log.OrderNumber, pattern)) ||
                (log.ProviderEventId != null && EF.Functions.ILike(log.ProviderEventId, pattern)));
        }

        return query;
    }

    private static IQueryable<AuditLog> ApplyDateFilter(IQueryable<AuditLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue)
        {
            query = query.Where(log => log.CreatedAt >= from.Value);
        }

        return to.HasValue ? query.Where(log => log.CreatedAt <= to.Value) : query;
    }

    private static IQueryable<OrderEventLog> ApplyDateFilter(IQueryable<OrderEventLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue)
        {
            query = query.Where(log => log.CreatedAt >= from.Value);
        }

        return to.HasValue ? query.Where(log => log.CreatedAt <= to.Value) : query;
    }

    private static IQueryable<PaymentEventLog> ApplyDateFilter(IQueryable<PaymentEventLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue)
        {
            query = query.Where(log => log.CreatedAt >= from.Value);
        }

        return to.HasValue ? query.Where(log => log.CreatedAt <= to.Value) : query;
    }

    private static IOrderedQueryable<AuditLog>? ApplyAuditSorting(IQueryable<AuditLog> query, string? sortBy, bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim().ToLowerInvariant();
        IOrderedQueryable<AuditLog>? sorted = normalizedSort switch
        {
            "createdat" => descending ? query.OrderByDescending(log => log.CreatedAt) : query.OrderBy(log => log.CreatedAt),
            "action" => descending ? query.OrderByDescending(log => log.Action) : query.OrderBy(log => log.Action),
            "entitytype" => descending ? query.OrderByDescending(log => log.EntityType) : query.OrderBy(log => log.EntityType),
            "actoremail" => descending ? query.OrderByDescending(log => log.ActorEmail) : query.OrderBy(log => log.ActorEmail),
            _ => null
        };

        return sorted is null ? null : descending ? sorted.ThenByDescending(log => log.Id) : sorted.ThenBy(log => log.Id);
    }

    private static IOrderedQueryable<OrderEventLog>? ApplyOrderEventSorting(IQueryable<OrderEventLog> query, string? sortBy, bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim().ToLowerInvariant();
        IOrderedQueryable<OrderEventLog>? sorted = normalizedSort switch
        {
            "createdat" => descending ? query.OrderByDescending(log => log.CreatedAt) : query.OrderBy(log => log.CreatedAt),
            "eventtype" => descending ? query.OrderByDescending(log => log.EventType) : query.OrderBy(log => log.EventType),
            "ordernumber" => descending ? query.OrderByDescending(log => log.OrderNumber) : query.OrderBy(log => log.OrderNumber),
            "actordisplayname" => descending ? query.OrderByDescending(log => log.ActorDisplayName) : query.OrderBy(log => log.ActorDisplayName),
            _ => null
        };

        return sorted is null ? null : descending ? sorted.ThenByDescending(log => log.Id) : sorted.ThenBy(log => log.Id);
    }

    private static IOrderedQueryable<PaymentEventLog>? ApplyPaymentEventSorting(IQueryable<PaymentEventLog> query, string? sortBy, bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim().ToLowerInvariant();
        IOrderedQueryable<PaymentEventLog>? sorted = normalizedSort switch
        {
            "createdat" => descending ? query.OrderByDescending(log => log.CreatedAt) : query.OrderBy(log => log.CreatedAt),
            "eventtype" => descending ? query.OrderByDescending(log => log.EventType) : query.OrderBy(log => log.EventType),
            "status" => descending ? query.OrderByDescending(log => log.Status) : query.OrderBy(log => log.Status),
            "ordernumber" => descending ? query.OrderByDescending(log => log.OrderNumber) : query.OrderBy(log => log.OrderNumber),
            "provider" => descending ? query.OrderByDescending(log => log.Provider) : query.OrderBy(log => log.Provider),
            _ => null
        };

        return sorted is null ? null : descending ? sorted.ThenByDescending(log => log.Id) : sorted.ThenBy(log => log.Id);
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

    private static AuditLogResponse MapAuditLog(AuditLog log, bool includeSensitiveDetails) =>
        new()
        {
            Id = log.Id,
            RestaurantId = log.RestaurantId,
            ActorUserId = log.ActorUserId,
            ActorEmail = log.ActorEmail,
            ActorRoles = log.ActorRoles,
            ActorType = log.ActorType,
            Source = log.Source,
            CorrelationId = log.CorrelationId,
            Action = log.Action,
            EntityType = log.EntityType,
            EntityId = log.EntityId,
            Summary = log.Summary,
            BeforeJson = log.BeforeJson,
            AfterJson = log.AfterJson,
            IpAddress = includeSensitiveDetails ? log.IpAddress : null,
            UserAgent = includeSensitiveDetails ? log.UserAgent : null,
            CreatedAt = log.CreatedAt
        };

    private static OrderEventLogResponse MapOrderEventLog(OrderEventLog log, bool includeTechnicalDetails) =>
        new()
        {
            Id = log.Id,
            RestaurantId = log.RestaurantId,
            OrderId = log.OrderId,
            OrderNumber = log.OrderNumber,
            ActorUserId = log.ActorUserId,
            ActorDisplayName = log.ActorDisplayName,
            ActorRoles = log.ActorRoles,
            ActorType = log.ActorType,
            Source = log.Source,
            CorrelationId = log.CorrelationId,
            EventType = log.EventType,
            Message = log.Message,
            DataJson = includeTechnicalDetails ? log.DataJson : null,
            CreatedAt = log.CreatedAt
        };

    private static PaymentEventLogResponse MapPaymentEventLog(PaymentEventLog log, bool includeTechnicalDetails) =>
        new()
        {
            Id = log.Id,
            RestaurantId = log.RestaurantId,
            OrderId = log.OrderId,
            OrderNumber = log.OrderNumber,
            PaymentId = log.PaymentId,
            PaymentRefundId = log.PaymentRefundId,
            Provider = log.Provider,
            EventType = log.EventType,
            ProviderEventId = log.ProviderEventId,
            Status = log.Status,
            Message = log.Message,
            DataJson = includeTechnicalDetails ? log.DataJson : null,
            ActorUserId = log.ActorUserId,
            ActorDisplayName = log.ActorDisplayName,
            ActorRoles = log.ActorRoles,
            ActorType = log.ActorType,
            Source = log.Source,
            CorrelationId = log.CorrelationId,
            CreatedAt = log.CreatedAt
        };
}
