using DineFlow.Infrastructure.Orders;

namespace DineFlow.Infrastructure.Printing;

public class PrintJob
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public Guid RestaurantId { get; set; }

    public int TicketRevision { get; set; } = 1;

    public string DeduplicationKey { get; set; } = string.Empty;

    public PrintJobTrigger Trigger { get; set; } = PrintJobTrigger.Automatic;

    public PrintJobState State { get; set; } = PrintJobState.Pending;

    public int Attempts { get; set; }

    public DateTime? NextAttemptAt { get; set; }

    public Guid? StationId { get; set; }

    public Guid? LeaseToken { get; set; }

    public DateTime? LeaseExpiresAt { get; set; }

    public string? LastError { get; set; }

    public string? LastStatusDetail { get; set; }

    public string? CreatedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? ClaimedAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    public Order Order { get; set; } = null!;

    public PrintStation? Station { get; set; }
}

public enum PrintJobTrigger
{
    Automatic,
    Manual,
    Reprint
}

public enum PrintJobState
{
    Pending,
    Claimed,
    Sending,
    SpoolAccepted,
    PrinterResponded,
    Completed,
    Failed,
    DeadLetter,
    Cancelled
}
