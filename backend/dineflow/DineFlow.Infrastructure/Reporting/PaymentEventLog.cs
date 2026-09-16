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

    /// <summary>
    /// What this event was worth, in the smallest unit of <see cref="Currency"/>: the refund's
    /// amount for a refund event, otherwise the payment's.
    /// </summary>
    /// <remarks>
    /// The log carried no money at all. Payment events are kept for seven years, which is a
    /// retention period chosen for financial evidence, yet a restaurant owner exporting their own
    /// seven years could read what happened — a counter tender recorded, a checkout session
    /// created, who did it — and never how much. The amount lived only inside DataJson, which is
    /// PlatformOwner-only, so the people who actually reconcile takings had to join back to the
    /// Payments table, which is not covered by this log's immutability or retention.
    /// </remarks>
    public long? AmountCents { get; set; }

    /// Alongside the amount, because cents mean nothing without it and this platform is
    /// deliberately multi-currency.
    public string? Currency { get; set; }

    public string Message { get; set; } = string.Empty;

    public string? DataJson { get; set; }

    public string? ActorUserId { get; set; }

    public string? ActorDisplayName { get; set; }

    public string? ActorRoles { get; set; }

    public string? ActorType { get; set; }

    public string? Source { get; set; }

    public string? CorrelationId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
