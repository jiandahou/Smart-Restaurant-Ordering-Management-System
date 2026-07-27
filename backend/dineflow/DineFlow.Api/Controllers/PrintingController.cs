using System.Data;
using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Printing;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Printing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/printing")]
[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public class PrintingController : ControllerBase
{
    private const int MaximumClaimSize = 10;
    private const int MaximumAutomaticAttempts = 10;
    private static readonly TimeSpan StationLeaseDuration = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan JobLeaseDuration = TimeSpan.FromSeconds(90);

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly ILogger<PrintingController> _logger;

    public PrintingController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        ILogger<PrintingController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _logger = logger;
    }

    [HttpPut("stations/{stationKey}")]
    public async Task<ActionResult<PrintStationResponse>> UpsertStation(
        string stationKey,
        UpsertPrintStationRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedStationKey = NormalizeRequired(stationKey, 120);
        var bodyStationKey = NormalizeRequired(request.StationKey, 120);
        var clientInstanceId = NormalizeOptional(request.ClientInstanceId, 120);
        if (normalizedStationKey is null || bodyStationKey is null ||
            !string.Equals(normalizedStationKey, bodyStationKey, StringComparison.Ordinal))
        {
            return BadRequest(new { message = "The station key is missing or does not match the route." });
        }

        var access = await ResolveRestaurantAsync(request.RestaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        var now = DateTime.UtcNow;
        var becameEnabled = false;
        var station = await _dbContext.PrintStations
            .SingleOrDefaultAsync(
                item => item.RestaurantId == access.RestaurantId && item.StationKey == normalizedStationKey,
                cancellationToken);

        if (station is null)
        {
            station = new PrintStation
            {
                Id = Guid.NewGuid(),
                RestaurantId = access.RestaurantId,
                StationKey = normalizedStationKey,
                Name = NormalizeOptional(request.Name, 160) ?? "Kitchen printer",
                AutoPrintEnabled = request.AutoPrintEnabled,
                AutoPrintEnabledAt = request.AutoPrintEnabled ? now : null,
                CreatedAt = now,
                UpdatedAt = now
            };
            _dbContext.PrintStations.Add(station);
            becameEnabled = request.AutoPrintEnabled;
        }
        else
        {
            if (!station.AutoPrintEnabled && request.AutoPrintEnabled)
            {
                station.AutoPrintEnabledAt = now;
                becameEnabled = true;
            }
            else if (station.AutoPrintEnabled && !request.AutoPrintEnabled)
            {
                station.AutoPrintEnabledAt = null;
                if (clientInstanceId is not null &&
                    string.Equals(station.LeaseOwner, clientInstanceId, StringComparison.Ordinal))
                {
                    station.LeaseOwner = null;
                    station.LeaseExpiresAt = null;
                }
            }

            station.AutoPrintEnabled = request.AutoPrintEnabled;
            station.Name = NormalizeOptional(request.Name, 160) ?? station.Name;
            station.UpdatedAt = now;
        }

        station.LastSeenAt = now;
        station.QzStatus = NormalizeOptional(request.QzStatus, 40);
        station.PrinterStatus = NormalizeOptional(request.PrinterStatus, 80);
        station.PrinterName = NormalizeOptional(request.PrinterName, 240);
        station.ConnectionType = NormalizeOptional(request.ConnectionType, 80);
        station.QzVersion = NormalizeOptional(request.QzVersion, 40);
        station.LastError = NormalizeOptional(request.LastError, 2_000);

        // Persist the "do not print historical stock" baseline at the moment the
        // switch is enabled. Unlike a component useRef/localStorage first scan,
        // this survives refreshes and other computers. Orders that are not yet
        // actionable (for example unpaid online orders) are intentionally not
        // suppressed; when they become paid later they receive a real print job.
        if (becameEnabled)
        {
            await SuppressExistingEligibleOrdersAsync(station, now, cancellationToken);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapStation(station, clientInstanceId, now));
    }

    [HttpPost("jobs/claim")]
    public async Task<ActionResult<ClaimPrintJobsResponse>> ClaimJobs(
        ClaimPrintJobsRequest request,
        CancellationToken cancellationToken)
    {
        var stationKey = NormalizeRequired(request.StationKey, 120);
        var clientInstanceId = NormalizeRequired(request.ClientInstanceId, 120);
        if (stationKey is null || clientInstanceId is null)
        {
            return BadRequest(new { message = "stationKey and clientInstanceId are required." });
        }

        var access = await ResolveRestaurantAsync(request.RestaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        var maxJobs = Math.Clamp(request.MaxJobs, 1, MaximumClaimSize);
        var now = DateTime.UtcNow;

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var station = await _dbContext.PrintStations
            .SingleOrDefaultAsync(
                item => item.RestaurantId == access.RestaurantId && item.StationKey == stationKey,
                cancellationToken);

        if (station is null)
        {
            return NotFound(new
            {
                message = "Print station is not registered. Save printer settings before claiming jobs."
            });
        }

        if (station.LeaseExpiresAt > now &&
            !string.Equals(station.LeaseOwner, clientInstanceId, StringComparison.Ordinal))
        {
            return Conflict(new
            {
                code = "station_lease_held",
                message = "Another browser tab or computer currently owns this print station.",
                leaseExpiresAt = station.LeaseExpiresAt
            });
        }

        station.LeaseOwner = clientInstanceId;
        station.LeaseExpiresAt = now.Add(StationLeaseDuration);
        station.LastSeenAt = now;
        station.UpdatedAt = now;

        if (station.AutoPrintEnabled && station.AutoPrintEnabledAt is not null)
        {
            await EnqueueEligibleAutomaticJobsAsync(station, now, cancellationToken);
        }

        var claimableStates = new[]
        {
            PrintJobState.Claimed,
            PrintJobState.Sending,
            PrintJobState.SpoolAccepted,
            PrintJobState.PrinterResponded
        };

        var jobs = await _dbContext.PrintJobs
            .Include(job => job.Order)
                .ThenInclude(order => order.OrderItems)
                    .ThenInclude(item => item.SelectedOptions)
            .Include(job => job.Order)
                .ThenInclude(order => order.Payments)
                    .ThenInclude(payment => payment.Refunds)
            .Include(job => job.Order.Customer)
            .Include(job => job.Order.Restaurant)
            .Include(job => job.Order.Table)
            .Where(job => job.RestaurantId == access.RestaurantId)
            .Where(job => job.StationId == null || job.StationId == station.Id)
            .Where(job => station.AutoPrintEnabled || job.Trigger != PrintJobTrigger.Automatic)
            .Where(job =>
                job.State == PrintJobState.Pending ||
                (job.State == PrintJobState.Failed && (job.NextAttemptAt == null || job.NextAttemptAt <= now)) ||
                (claimableStates.Contains(job.State) && job.LeaseExpiresAt <= now))
            .Where(job => job.Attempts < MaximumAutomaticAttempts || job.Trigger != PrintJobTrigger.Automatic)
            .OrderBy(job => job.NextAttemptAt ?? job.CreatedAt)
            .ThenBy(job => job.CreatedAt)
            .Take(maxJobs)
            .ToListAsync(cancellationToken);

        foreach (var job in jobs)
        {
            job.State = PrintJobState.Claimed;
            job.StationId = station.Id;
            job.LeaseToken = Guid.NewGuid();
            job.LeaseExpiresAt = now.Add(JobLeaseDuration);
            job.ClaimedAt = now;
            job.UpdatedAt = now;
            job.Attempts += 1;
            job.NextAttemptAt = null;
            job.LastStatusDetail = "Claimed by print station.";
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var counts = await GetOpenCountsAsync(access.RestaurantId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return Ok(new ClaimPrintJobsResponse
        {
            Station = MapStation(station, clientInstanceId, now),
            Jobs = jobs.Select(MapJob).ToList(),
            PendingCount = counts.Pending,
            FailedCount = counts.Failed
        });
    }

    [HttpPost("jobs/{jobId:guid}/status")]
    public async Task<ActionResult<PrintJobResponse>> UpdateJobStatus(
        Guid jobId,
        UpdatePrintJobStatusRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<PrintJobState>(request.Status, true, out var requestedState) ||
            requestedState is PrintJobState.Pending or PrintJobState.Claimed)
        {
            return BadRequest(new
            {
                message = "Unsupported print status.",
                allowedValues = new[]
                {
                    "Sending", "SpoolAccepted", "PrinterResponded", "Completed",
                    "Failed", "DeadLetter", "Cancelled"
                }
            });
        }

        var job = await BuildJobQuery()
            .SingleOrDefaultAsync(item => item.Id == jobId, cancellationToken);
        if (job is null) return NotFound(new { message = "Print job not found." });

        var access = await ResolveRestaurantAsync(job.RestaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        if (job.LeaseToken is null || job.LeaseToken != request.LeaseToken ||
            job.LeaseExpiresAt < DateTime.UtcNow)
        {
            return Conflict(new
            {
                code = "print_job_lease_lost",
                message = "This print job lease has expired or belongs to another station."
            });
        }

        var now = DateTime.UtcNow;
        job.LastStatusDetail = NormalizeOptional(request.Detail, 2_000);
        job.UpdatedAt = now;

        if (requestedState == PrintJobState.Failed)
        {
            job.LastError = NormalizeOptional(request.Error, 2_000) ?? "The print attempt failed.";
            if (job.Trigger == PrintJobTrigger.Automatic && job.Attempts >= MaximumAutomaticAttempts)
            {
                job.State = PrintJobState.DeadLetter;
                job.NextAttemptAt = null;
            }
            else
            {
                job.State = PrintJobState.Failed;
                job.NextAttemptAt = now.AddSeconds(CalculateRetryDelaySeconds(job.Attempts));
            }
            ClearJobLease(job);
        }
        else if (requestedState is PrintJobState.Completed or PrintJobState.DeadLetter or PrintJobState.Cancelled)
        {
            job.State = requestedState;
            job.LastError = NormalizeOptional(request.Error, 2_000);
            job.CompletedAt = requestedState == PrintJobState.Completed ? now : null;
            job.NextAttemptAt = null;

            if (requestedState == PrintJobState.Completed && job.StationId.HasValue)
            {
                var station = await _dbContext.PrintStations
                    .SingleOrDefaultAsync(item => item.Id == job.StationId.Value, cancellationToken);
                if (station is not null)
                {
                    station.LastSuccessfulPrintAt = now;
                    station.LastError = null;
                    station.LastSeenAt = now;
                    station.UpdatedAt = now;
                }
            }

            ClearJobLease(job);
        }
        else
        {
            job.State = requestedState;
            job.LeaseExpiresAt = now.Add(JobLeaseDuration);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapJob(job));
    }

    [HttpGet("jobs")]
    public async Task<ActionResult<PrintJobListResponse>> GetJobs(
        [FromQuery] Guid? restaurantId,
        [FromQuery] string? state,
        [FromQuery] int take = 100,
        CancellationToken cancellationToken = default)
    {
        var access = await ResolveRestaurantAsync(restaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        PrintJobState? parsedState = null;
        if (!string.IsNullOrWhiteSpace(state))
        {
            if (!Enum.TryParse<PrintJobState>(state, true, out var stateValue))
            {
                return BadRequest(new { message = "Unsupported print job state." });
            }
            parsedState = stateValue;
        }

        var query = BuildJobQuery()
            .AsNoTracking()
            .Where(job => job.RestaurantId == access.RestaurantId);
        if (parsedState.HasValue)
        {
            query = query.Where(job => job.State == parsedState.Value);
        }

        var jobs = await query
            .OrderByDescending(job => job.UpdatedAt)
            .ThenByDescending(job => job.Id)
            .Take(Math.Clamp(take, 1, 200))
            .ToListAsync(cancellationToken);
        var counts = await GetOpenCountsAsync(access.RestaurantId, cancellationToken);

        return Ok(new PrintJobListResponse
        {
            Jobs = jobs.Select(MapJob).ToList(),
            PendingCount = counts.Pending,
            FailedCount = counts.Failed,
            DeadLetterCount = counts.DeadLetter
        });
    }

    [HttpPost("orders/{orderId:guid}/reprint")]
    public async Task<ActionResult<PrintJobResponse>> ReprintOrder(
        Guid orderId,
        ReprintOrderRequest request,
        CancellationToken cancellationToken)
    {
        var stationKey = NormalizeRequired(request.StationKey, 120);
        if (stationKey is null) return BadRequest(new { message = "stationKey is required." });

        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.Customer)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .SingleOrDefaultAsync(item => item.Id == orderId, cancellationToken);
        if (order is null || order.RestaurantId is null)
        {
            return NotFound(new { message = "Order not found or is not assigned to a restaurant." });
        }

        var access = await ResolveRestaurantAsync(order.RestaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        var station = await _dbContext.PrintStations.SingleOrDefaultAsync(
            item => item.RestaurantId == order.RestaurantId && item.StationKey == stationKey,
            cancellationToken);
        if (station is null) return NotFound(new { message = "Print station not found." });

        var now = DateTime.UtcNow;
        var job = new PrintJob
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Order = order,
            RestaurantId = order.RestaurantId.Value,
            TicketRevision = order.TicketRevision,
            DeduplicationKey = $"reprint:{order.Id:N}:{Guid.NewGuid():N}",
            Trigger = PrintJobTrigger.Reprint,
            State = PrintJobState.Pending,
            StationId = station.Id,
            CreatedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            LastStatusDetail = NormalizeOptional(request.Reason, 2_000) ?? "Manual reprint requested.",
            CreatedAt = now,
            UpdatedAt = now
        };
        _dbContext.PrintJobs.Add(job);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapJob(job));
    }

    [HttpPost("jobs/{jobId:guid}/retry")]
    public async Task<ActionResult<PrintJobResponse>> RetryJob(
        Guid jobId,
        RetryPrintJobRequest request,
        CancellationToken cancellationToken)
    {
        var job = await BuildJobQuery()
            .SingleOrDefaultAsync(item => item.Id == jobId, cancellationToken);
        if (job is null) return NotFound(new { message = "Print job not found." });

        var access = await ResolveRestaurantAsync(job.RestaurantId, cancellationToken);
        if (access.Error is not null) return access.Error;

        job.State = PrintJobState.Pending;
        job.Trigger = PrintJobTrigger.Manual;
        job.Attempts = 0;
        job.NextAttemptAt = null;
        job.LastError = null;
        job.LastStatusDetail = NormalizeOptional(request.Reason, 2_000) ?? "Manual retry requested.";
        job.UpdatedAt = DateTime.UtcNow;
        ClearJobLease(job);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(MapJob(job));
    }

    private async Task EnqueueEligibleAutomaticJobsAsync(
        PrintStation station,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var eligibleOrders = await _dbContext.Orders
            .AsNoTracking()
            .Where(order => order.RestaurantId == station.RestaurantId)
            .Where(order => order.Status != OrderStatus.Completed &&
                            order.Status != OrderStatus.Cancelled &&
                            order.Status != OrderStatus.Rejected)
            .Where(order => order.PaymentMethod == PaymentMethod.PayAtCounter ||
                            order.PaymentStatus == PaymentStatus.Paid)
            .Where(order => !_dbContext.PrintJobs.Any(job =>
                job.OrderId == order.Id &&
                job.TicketRevision == order.TicketRevision &&
                job.Trigger == PrintJobTrigger.Automatic))
            .OrderBy(order => order.CreatedAt)
            .Take(500)
            .Select(order => new { order.Id, order.TicketRevision, order.CreatedAt })
            .ToListAsync(cancellationToken);

        if (eligibleOrders.Count == 0) return;

        var orderIds = eligibleOrders.Select(order => order.Id).ToList();
        var existingKeyList = await _dbContext.PrintJobs
            .AsNoTracking()
            .Where(job => orderIds.Contains(job.OrderId) && job.Trigger == PrintJobTrigger.Automatic)
            .Select(job => job.DeduplicationKey)
            .ToListAsync(cancellationToken);
        var existingKeys = existingKeyList.ToHashSet(StringComparer.Ordinal);

        foreach (var order in eligibleOrders)
        {
            var key = AutomaticDeduplicationKey(order.Id, order.TicketRevision);
            if (existingKeys.Contains(key)) continue;

            _dbContext.PrintJobs.Add(new PrintJob
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                RestaurantId = station.RestaurantId,
                TicketRevision = order.TicketRevision,
                DeduplicationKey = key,
                Trigger = PrintJobTrigger.Automatic,
                State = PrintJobState.Pending,
                StationId = station.Id,
                CreatedAt = order.CreatedAt,
                UpdatedAt = now
            });
        }
    }

    private async Task SuppressExistingEligibleOrdersAsync(
        PrintStation station,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var existingOrders = await _dbContext.Orders
            .AsNoTracking()
            .Where(order => order.RestaurantId == station.RestaurantId)
            .Where(order => order.Status != OrderStatus.Completed &&
                            order.Status != OrderStatus.Cancelled &&
                            order.Status != OrderStatus.Rejected)
            .Where(order => order.PaymentMethod == PaymentMethod.PayAtCounter ||
                            order.PaymentStatus == PaymentStatus.Paid)
            .Where(order => !_dbContext.PrintJobs.Any(job =>
                job.OrderId == order.Id &&
                job.TicketRevision == order.TicketRevision &&
                job.Trigger == PrintJobTrigger.Automatic))
            .Select(order => new { order.Id, order.TicketRevision })
            .ToListAsync(cancellationToken);

        foreach (var order in existingOrders)
        {
            _dbContext.PrintJobs.Add(new PrintJob
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                RestaurantId = station.RestaurantId,
                TicketRevision = order.TicketRevision,
                DeduplicationKey = AutomaticDeduplicationKey(order.Id, order.TicketRevision),
                Trigger = PrintJobTrigger.Automatic,
                State = PrintJobState.Cancelled,
                StationId = station.Id,
                LastStatusDetail = "Existing order suppressed when auto-print was enabled.",
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        if (existingOrders.Count > 0)
        {
            _logger.LogInformation(
                "Print station {StationKey} persisted a baseline of {OrderCount} existing eligible orders.",
                station.StationKey,
                existingOrders.Count);
        }
    }

    private IQueryable<PrintJob> BuildJobQuery() =>
        _dbContext.PrintJobs
            .Include(job => job.Order)
                .ThenInclude(order => order.OrderItems)
                    .ThenInclude(item => item.SelectedOptions)
            .Include(job => job.Order)
                .ThenInclude(order => order.Payments)
                    .ThenInclude(payment => payment.Refunds)
            .Include(job => job.Order.Customer)
            .Include(job => job.Order.Restaurant)
            .Include(job => job.Order.Table);

    private async Task<(Guid RestaurantId, ActionResult? Error)> ResolveRestaurantAsync(
        Guid? requestedRestaurantId,
        CancellationToken cancellationToken)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            if (!requestedRestaurantId.HasValue)
            {
                return (Guid.Empty, BadRequest(new
                {
                    message = "restaurantId is required for a platform owner print station."
                }));
            }
            return (requestedRestaurantId.Value, null);
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return (Guid.Empty, Forbid());
        }

        var currentUser = await _userManager.FindByIdAsync(userId);
        if (currentUser?.RestaurantId is null)
        {
            return (Guid.Empty, Forbid());
        }

        if (requestedRestaurantId.HasValue && requestedRestaurantId != currentUser.RestaurantId)
        {
            return (Guid.Empty, Forbid());
        }

        return (currentUser.RestaurantId.Value, null);
    }

    private async Task<(int Pending, int Failed, int DeadLetter)> GetOpenCountsAsync(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var counts = await _dbContext.PrintJobs
            .AsNoTracking()
            .Where(job => job.RestaurantId == restaurantId)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Pending = group.Count(job =>
                    job.State == PrintJobState.Pending ||
                    job.State == PrintJobState.Claimed ||
                    job.State == PrintJobState.Sending ||
                    job.State == PrintJobState.SpoolAccepted ||
                    job.State == PrintJobState.PrinterResponded),
                Failed = group.Count(job => job.State == PrintJobState.Failed),
                DeadLetter = group.Count(job => job.State == PrintJobState.DeadLetter)
            })
            .SingleOrDefaultAsync(cancellationToken);

        return counts is null
            ? (0, 0, 0)
            : (counts.Pending, counts.Failed, counts.DeadLetter);
    }

    private static PrintStationResponse MapStation(
        PrintStation station,
        string? clientInstanceId,
        DateTime now) =>
        new()
        {
            Id = station.Id,
            RestaurantId = station.RestaurantId,
            StationKey = station.StationKey,
            Name = station.Name,
            AutoPrintEnabled = station.AutoPrintEnabled,
            AutoPrintEnabledAt = station.AutoPrintEnabledAt,
            LeaseHeldByAnotherClient = station.LeaseExpiresAt > now &&
                !string.IsNullOrWhiteSpace(station.LeaseOwner) &&
                !string.Equals(station.LeaseOwner, clientInstanceId, StringComparison.Ordinal),
            LeaseExpiresAt = station.LeaseExpiresAt,
            LastSeenAt = station.LastSeenAt,
            QzStatus = station.QzStatus,
            PrinterStatus = station.PrinterStatus,
            PrinterName = station.PrinterName,
            ConnectionType = station.ConnectionType,
            QzVersion = station.QzVersion,
            LastError = station.LastError,
            LastSuccessfulPrintAt = station.LastSuccessfulPrintAt,
            UpdatedAt = station.UpdatedAt
        };

    private static PrintJobResponse MapJob(PrintJob job) =>
        new()
        {
            Id = job.Id,
            OrderId = job.OrderId,
            RestaurantId = job.RestaurantId,
            TicketRevision = job.TicketRevision,
            Trigger = job.Trigger.ToString(),
            State = job.State.ToString(),
            Attempts = job.Attempts,
            NextAttemptAt = job.NextAttemptAt,
            StationId = job.StationId,
            LeaseToken = job.LeaseToken,
            LeaseExpiresAt = job.LeaseExpiresAt,
            LastError = job.LastError,
            LastStatusDetail = job.LastStatusDetail,
            CreatedAt = job.CreatedAt,
            UpdatedAt = job.UpdatedAt,
            CompletedAt = job.CompletedAt,
            Order = AdminOrdersController.MapToAdminResponse(job.Order)
        };

    private static void ClearJobLease(PrintJob job)
    {
        job.LeaseToken = null;
        job.LeaseExpiresAt = null;
    }

    private static string AutomaticDeduplicationKey(Guid orderId, int ticketRevision) =>
        $"auto:{orderId:N}:{ticketRevision}";

    private static int CalculateRetryDelaySeconds(int attempts)
    {
        var exponent = Math.Clamp(attempts - 1, 0, 5);
        return Math.Min(15 * (1 << exponent), 300);
    }

    private static string? NormalizeRequired(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized.Length > maxLength) return null;
        return normalized;
    }

    private static string? NormalizeOptional(string? value, int maxLength)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized)) return null;
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
    }
}
