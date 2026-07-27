using DineFlow.Api.Contracts.Order;

namespace DineFlow.Api.Contracts.Printing;

public sealed class PrintStationResponse
{
    public Guid Id { get; set; }
    public Guid RestaurantId { get; set; }
    public string StationKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool AutoPrintEnabled { get; set; }
    public DateTime? AutoPrintEnabledAt { get; set; }
    public bool LeaseHeldByAnotherClient { get; set; }
    public DateTime? LeaseExpiresAt { get; set; }
    public DateTime? LastSeenAt { get; set; }
    public string? QzStatus { get; set; }
    public string? PrinterStatus { get; set; }
    public string? PrinterName { get; set; }
    public string? ConnectionType { get; set; }
    public string? QzVersion { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastSuccessfulPrintAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed class PrintJobResponse
{
    public Guid Id { get; set; }
    public Guid OrderId { get; set; }
    public Guid RestaurantId { get; set; }
    public int TicketRevision { get; set; }
    public string Trigger { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public int Attempts { get; set; }
    public DateTime? NextAttemptAt { get; set; }
    public Guid? StationId { get; set; }
    public Guid? LeaseToken { get; set; }
    public DateTime? LeaseExpiresAt { get; set; }
    public string? LastError { get; set; }
    public string? LastStatusDetail { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public AdminOrderResponse Order { get; set; } = new();
}

public sealed class ClaimPrintJobsResponse
{
    public PrintStationResponse Station { get; set; } = new();
    public List<PrintJobResponse> Jobs { get; set; } = [];
    public int PendingCount { get; set; }
    public int FailedCount { get; set; }
}

public sealed class PrintJobListResponse
{
    public List<PrintJobResponse> Jobs { get; set; } = [];
    public int PendingCount { get; set; }
    public int FailedCount { get; set; }
    public int DeadLetterCount { get; set; }
}
