namespace DineFlow.Api.Options;

public sealed class ReportRetentionOptions
{
    public const string SectionName = "ReportRetention";

    /// <summary>
    /// True only when the separately credentialed maintenance job is scheduled and enabled.
    /// The web application's database role deliberately cannot delete report evidence.
    /// </summary>
    public bool ExternalMaintenanceEnabled { get; set; }

    public string ScheduledJobReference { get; set; } = string.Empty;

    public string ArchiveDestination { get; set; } = string.Empty;

    public string LegalHoldRegister { get; set; } = string.Empty;

    public DateTimeOffset? LastRestoreDrillUtc { get; set; }

    public bool HasCurrentRestoreDrill(DateTimeOffset now) =>
        LastRestoreDrillUtc is { } drill &&
        drill <= now &&
        drill >= now.AddYears(-1);

    public bool IsOperationallyConfigured(DateTimeOffset now) =>
        ExternalMaintenanceEnabled &&
        !string.IsNullOrWhiteSpace(ScheduledJobReference) &&
        !string.IsNullOrWhiteSpace(ArchiveDestination) &&
        !string.IsNullOrWhiteSpace(LegalHoldRegister) &&
        HasCurrentRestoreDrill(now);
}
