namespace DineFlow.Infrastructure.Reporting;

/// <summary>
/// How long each kind of report evidence is kept, and therefore what a maintenance run may delete.
/// </summary>
/// <remarks>
/// <para>
/// The numbers were published by the policy endpoint and enforced by nothing: rows accumulated
/// forever. That is not a harmless overshoot — keeping personal data past its stated period is the
/// same kind of failure as deleting it early, and the published figure was evidence the platform
/// could not produce.
/// </para>
/// <para>
/// Stated here rather than inside the maintenance job so the endpoint that publishes the promise and
/// the job that keeps it read from one place.
/// </para>
/// </remarks>
public static class ReportRetentionSchedule
{
    /// <summary>Administrative and security evidence: seven years.</summary>
    public const int AuditRetentionDays = 2_555;

    /// <summary>Operational history and customer support: two years.</summary>
    public const int OrderEventRetentionDays = 730;

    /// <summary>Financial reconciliation and dispute support: seven years.</summary>
    public const int PaymentEventRetentionDays = 2_555;

    public static int RetentionDays(HeldRecordType recordType) => recordType switch
    {
        HeldRecordType.AuditLog => AuditRetentionDays,
        HeldRecordType.OrderEvent => OrderEventRetentionDays,
        HeldRecordType.PaymentEvent => PaymentEventRetentionDays,
        _ => throw new ArgumentOutOfRangeException(nameof(recordType)),
    };

    /// <summary>Anything created strictly before this instant is out of retention.</summary>
    public static DateTime CutoffFor(HeldRecordType recordType, DateTime now) =>
        now.AddDays(-RetentionDays(recordType));

    public static IReadOnlyList<HeldRecordType> AllRecordTypes =>
        [HeldRecordType.AuditLog, HeldRecordType.OrderEvent, HeldRecordType.PaymentEvent];
}
