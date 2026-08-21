using DineFlow.Api.Options;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// What the product is entitled to claim about retention.
/// </summary>
/// <remarks>
/// <para>
/// The five <c>ReportRetention__*</c> settings are evidence references someone typed into
/// configuration. Nothing in the runtime checks that a scheduler ran, that an archive was written,
/// or that a single row was ever deleted — by design, since the retention policy requires that the
/// web runtime never hold the deleting database role or the archive writer credentials.
/// </para>
/// <para>
/// So the words matter. The API said "verified" and the Reports screen said "Enforced", which is the
/// exact implication the policy document warns against: it tells an operator — and whoever reads an
/// export of that screen — that deletion and archival are running, on the strength of five strings.
/// </para>
/// </remarks>
public class ReportRetentionClaimTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 17, 0, 0, 0, TimeSpan.Zero);

    private static ReportRetentionOptions Declared(DateTimeOffset? drill = null) => new()
    {
        ExternalMaintenanceEnabled = true,
        ScheduledJobReference = "retention-maintenance@rev-42",
        ArchiveDestination = "s3://dineflow-archive/reports",
        LegalHoldRegister = "https://legal.example/holds",
        LastRestoreDrillUtc = drill ?? Now.AddDays(-30)
    };

    [Fact]
    public void AFullyDeclaredGatePasses()
    {
        Assert.True(Declared().IsOperationallyConfigured(Now));
    }

    /// <summary>Every one of the five is load-bearing; a gate with a hole in it is not a gate.</summary>
    [Fact]
    public void EveryPieceOfEvidenceIsRequired()
    {
        var missingFlag = Declared();
        missingFlag.ExternalMaintenanceEnabled = false;
        Assert.False(missingFlag.IsOperationallyConfigured(Now));

        var missingJob = Declared();
        missingJob.ScheduledJobReference = "   ";
        Assert.False(missingJob.IsOperationallyConfigured(Now));

        var missingArchive = Declared();
        missingArchive.ArchiveDestination = string.Empty;
        Assert.False(missingArchive.IsOperationallyConfigured(Now));

        var missingRegister = Declared();
        missingRegister.LegalHoldRegister = string.Empty;
        Assert.False(missingRegister.IsOperationallyConfigured(Now));

        var noDrill = Declared();
        noDrill.LastRestoreDrillUtc = null;
        Assert.False(noDrill.IsOperationallyConfigured(Now));
    }

    /// <summary>A drill goes stale in a year, and a future-dated one is not a drill.</summary>
    [Fact]
    public void ADrillExpiresAndCannotBeInTheFuture()
    {
        Assert.True(Declared(Now.AddDays(-364)).IsOperationallyConfigured(Now));
        Assert.False(Declared(Now.AddDays(-366)).IsOperationallyConfigured(Now));
        Assert.False(Declared(Now.AddDays(1)).IsOperationallyConfigured(Now));
    }

    /// <summary>
    /// The claim must not outrun what was checked.
    /// </summary>
    /// <remarks>
    /// Read from the source rather than by calling the endpoint, because what is being guarded is the
    /// wording itself: the previous version passed every functional test while telling an operator
    /// something nobody had established.
    /// </remarks>
    [Fact]
    public void TheReportedStatusDoesNotClaimVerification()
    {
        var controller = File.ReadAllText(Path.Combine(
            RepositoryRoot(), "DineFlow.Api", "Controllers", "AdminReportsController.cs"));
        var status = controller[controller.IndexOf("RetentionStatus =", StringComparison.Ordinal)..];
        status = status[..status.IndexOf("});", StringComparison.Ordinal)];

        Assert.DoesNotContain("verified", status, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Declared", status, StringComparison.Ordinal);
        Assert.Contains("not checked here", status, StringComparison.Ordinal);
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
