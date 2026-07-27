namespace DineFlow.Infrastructure.Printing;

public class PrintStation
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public string StationKey { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool AutoPrintEnabled { get; set; }

    public DateTime? AutoPrintEnabledAt { get; set; }

    public string? LeaseOwner { get; set; }

    public DateTime? LeaseExpiresAt { get; set; }

    public DateTime? LastSeenAt { get; set; }

    public string? QzStatus { get; set; }

    public string? PrinterStatus { get; set; }

    public string? PrinterName { get; set; }

    public string? ConnectionType { get; set; }

    public string? QzVersion { get; set; }

    public string? LastError { get; set; }

    public DateTime? LastSuccessfulPrintAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<PrintJob> Jobs { get; set; } = [];
}
