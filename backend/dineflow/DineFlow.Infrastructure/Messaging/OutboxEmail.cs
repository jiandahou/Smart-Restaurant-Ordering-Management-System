namespace DineFlow.Infrastructure.Messaging;

public enum OutboxEmailStatus
{
    Pending = 0,
    Sent = 1,
    /// <summary>Tried until the budget ran out. Nothing further will be attempted automatically.</summary>
    DeadLettered = 2,
}

/// <summary>
/// One transactional email, durable from the moment it is decided on.
/// </summary>
/// <remarks>
/// <para>
/// Sending used to happen inline, and a provider failure was caught and written to a log line. The
/// email was then gone: no retry, no record that anybody had ever meant to send it, and no way to
/// answer "did the customer get told their refund was approved?" other than asking the customer.
/// Money moves in these flows, so the answer matters and a log file is not it.
/// </para>
/// <para>
/// The row is the audit as much as it is the queue. Attempts, the last provider error, and the
/// instant it went out all stay after delivery, which is what makes a delivery question answerable
/// months later.
/// </para>
/// </remarks>
public class OutboxEmail
{
    public Guid Id { get; set; }

    /// <summary>
    /// What this email is about, so the same decision cannot be queued twice.
    /// </summary>
    /// <remarks>
    /// Retries of the calling operation are the ordinary case — a webhook Stripe redelivers, a
    /// button pressed twice. Without this the customer gets the same refund notice four times, and
    /// nothing about that reads as a system working correctly.
    /// </remarks>
    public string IdempotencyKey { get; set; } = string.Empty;

    /// <summary>Which flow queued it, so delivery can be reported per kind rather than in total.</summary>
    public string Category { get; set; } = string.Empty;

    public string Recipient { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string HtmlBody { get; set; } = string.Empty;
    public string? TextBody { get; set; }

    public OutboxEmailStatus Status { get; set; } = OutboxEmailStatus.Pending;

    public int AttemptCount { get; set; }

    /// <summary>When the worker may try again. Null once the row is settled either way.</summary>
    public DateTime? NextAttemptAt { get; set; }

    /// <summary>What the provider said last time, kept for the person who has to explain it.</summary>
    public string? LastError { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public DateTime? SentAt { get; set; }

    /// <summary>The order or user this concerns, so a delivery question can start from the record.</summary>
    public Guid? OrderId { get; set; }
    public Guid? RestaurantId { get; set; }
}
