namespace DineFlow.Infrastructure.Reporting;

public class PaymentEventLog
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid? RestaurantId { get; set; }

    public Guid? OrderId { get; set; }

    public string? OrderNumber { get; set; }

    public Guid? PaymentId { get; set; }

    public Guid? PaymentRefundId { get; set; }

    public string Provider { get; set; } = string.Empty;

    public string EventType { get; set; } = string.Empty;

    public string? ProviderEventId { get; set; }

    public string? Status { get; set; }

    public string Message { get; set; } = string.Empty;

    public string? DataJson { get; set; }

    public string? ActorUserId { get; set; }

    public string? ActorDisplayName { get; set; }

    public string? ActorRoles { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
