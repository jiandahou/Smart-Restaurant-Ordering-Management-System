namespace DineFlow.Infrastructure.Reporting;

public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid? RestaurantId { get; set; }

    public string? ActorUserId { get; set; }

    public string? ActorEmail { get; set; }

    public string? ActorRoles { get; set; }

    public string? ActorType { get; set; }

    public string? Source { get; set; }

    public string? CorrelationId { get; set; }

    public string Action { get; set; } = string.Empty;

    public string EntityType { get; set; } = string.Empty;

    public string? EntityId { get; set; }

    public string? Summary { get; set; }

    public string? BeforeJson { get; set; }

    public string? AfterJson { get; set; }

    public string? IpAddress { get; set; }

    public string? UserAgent { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
