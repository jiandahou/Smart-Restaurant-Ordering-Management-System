using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Reports;

public sealed class ActivityLogListRequest : PagedRequest
{
    public Guid? RestaurantId { get; set; }

    public string? Category { get; set; }

    public string? ActorType { get; set; }

    public string? Outcome { get; set; }

    public DateTime? CreatedFrom { get; set; }

    public DateTime? CreatedTo { get; set; }
}

public sealed class ActivityLogResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string? RestaurantTimeZone { get; set; }

    public DateTime OccurredAt { get; set; }

    public string Category { get; set; } = string.Empty;

    public string Severity { get; set; } = "Info";

    public string EventType { get; set; } = string.Empty;

    public string ActionLabel { get; set; } = string.Empty;

    public string ActorType { get; set; } = "System";

    public string ActorName { get; set; } = "DineFlow";

    public string? ActorRoles { get; set; }

    public string Source { get; set; } = "DineFlow";

    public string Description { get; set; } = string.Empty;

    public string? SubjectType { get; set; }

    public string? SubjectId { get; set; }

    public string? SubjectLabel { get; set; }

    public Guid? OrderId { get; set; }

    public string? OrderNumber { get; set; }

    public Guid? PaymentId { get; set; }

    public string? Status { get; set; }

    public long? AmountCents { get; set; }

    public string? Currency { get; set; }

    public string? CorrelationId { get; set; }

    public string? TechnicalJson { get; set; }
}

public sealed class ActivitySummaryResponse
{
    public string TimeZone { get; set; } = "UTC";

    public int ActivityCountToday { get; set; }

    public int CompletedOrdersToday { get; set; }

    public int FailedPaymentsToday { get; set; }

    public IReadOnlyList<ActivityMoneyTotalResponse> PaymentsReceivedToday { get; set; } = [];

    public IReadOnlyList<ActivityMoneyTotalResponse> RefundsSucceededToday { get; set; } = [];

    // FS-017. Live rather than daily: the question is whether a customer is being left waiting
    // right now, having already paid, on an order no one in the restaurant has accepted.
    public int OrdersAwaitingAcceptance { get; set; }

    public int OrdersOverdueForAcceptance { get; set; }

    public int? LongestAcceptanceWaitMinutes { get; set; }
}

public sealed class ActivityMoneyTotalResponse
{
    public string Currency { get; set; } = string.Empty;

    public int Count { get; set; }

    public long AmountCents { get; set; }
}

public sealed class ReportPolicyResponse
{
    public int MaxExportRows { get; set; }

    public int AuditRetentionDays { get; set; }

    public int OrderEventRetentionDays { get; set; }

    public int PaymentEventRetentionDays { get; set; }

    public bool LogsAreImmutable { get; set; }

    public bool SensitiveTechnicalDetailsRequirePlatformOwner { get; set; }

    public bool RetentionEnforcementConfigured { get; set; }

    public bool LegalHoldWorkflowConfigured { get; set; }

    public bool RestoreDrillCurrent { get; set; }

    /// <summary>
    /// How long ago the last restore drill was declared, or null when none has been.
    /// </summary>
    /// <remarks>
    /// The gate only asks whether a drill happened within a year, so a drill from three hundred and
    /// sixty-four days ago reads exactly like one from yesterday. Whoever has to arrange the next one
    /// needs the number, not the boolean.
    /// </remarks>
    public int? RestoreDrillAgeDays { get; set; }

    public string RetentionStatus { get; set; } = string.Empty;
}
