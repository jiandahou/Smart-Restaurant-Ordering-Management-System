namespace DineFlow.Api.Contracts.Reports;

public sealed class AuditLogResponse
{
    public Guid Id { get; set; }

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

    public DateTime CreatedAt { get; set; }
}

public sealed class OrderEventLogResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public Guid OrderId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public string? ActorUserId { get; set; }

    public string? ActorDisplayName { get; set; }

    public string? ActorRoles { get; set; }

    public string? ActorType { get; set; }

    public string? Source { get; set; }

    public string? CorrelationId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public string? DataJson { get; set; }

    public DateTime CreatedAt { get; set; }
}

public sealed class PaymentEventLogResponse
{
    public Guid Id { get; set; }

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

    public string? ActorType { get; set; }

    public string? Source { get; set; }

    public string? CorrelationId { get; set; }

    public DateTime CreatedAt { get; set; }
}
