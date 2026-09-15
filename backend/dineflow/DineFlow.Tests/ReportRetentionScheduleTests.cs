using DineFlow.Api.Services;
using DineFlow.Infrastructure.Reporting;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The published retention periods, the hold that overrides them, and the archive that has to exist
/// before anything is deleted. Kept apart from the database tests so the rules can be read on their
/// own — a period nobody can state precisely is a period nobody can enforce.
/// </summary>
public sealed class ReportRetentionScheduleTests
{
    private static readonly DateTime Now = new(2026, 8, 21, 0, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(HeldRecordType.AuditLog, 2_555)]
    [InlineData(HeldRecordType.PaymentEvent, 2_555)]
    [InlineData(HeldRecordType.OrderEvent, 730)]
    public void ThePeriodsMatchThePublishedPolicy(HeldRecordType recordType, int days)
    {
        Assert.Equal(days, ReportRetentionSchedule.RetentionDays(recordType));
        Assert.Equal(Now.AddDays(-days), ReportRetentionSchedule.CutoffFor(recordType, Now));
    }

    [Fact]
    public void TheEndpointAndTheJobReadTheSameNumbers()
    {
        // Two copies of a retention period is one copy that quietly becomes a different promise
        // from the one the policy page makes.
        Assert.Equal(AdminActivityReportService.AuditRetentionDays, ReportRetentionSchedule.AuditRetentionDays);
        Assert.Equal(AdminActivityReportService.OrderEventRetentionDays, ReportRetentionSchedule.OrderEventRetentionDays);
        Assert.Equal(AdminActivityReportService.PaymentEventRetentionDays, ReportRetentionSchedule.PaymentEventRetentionDays);
    }

    [Fact]
    public void EveryKindOfEvidenceIsCoveredBySomeRun()
    {
        // A record type nobody swept would accumulate for ever with nothing saying so.
        Assert.Equal(
            Enum.GetValues<HeldRecordType>().OrderBy(value => value),
            ReportRetentionSchedule.AllRecordTypes.OrderBy(value => value));
    }

    private static LegalHold Hold(
        HeldRecordType recordType = HeldRecordType.OrderEvent,
        Guid? restaurantId = null,
        Guid? orderId = null) =>
        new()
        {
            RecordType = recordType,
            RestaurantId = restaurantId,
            OrderId = orderId,
            Reason = "Under review.",
            PlacedBy = "compliance@dineflow.test",
            PlacedAt = Now.AddDays(-1),
        };

    [Fact]
    public void AHoldOnOneOrderCoversThatOrder()
    {
        var orderId = Guid.NewGuid();

        Assert.True(LegalHoldScope.Covers([Hold(orderId: orderId)], HeldRecordType.OrderEvent, null, orderId));
    }

    [Fact]
    public void AHoldOnOneOrderDoesNotCoverAnother()
    {
        Assert.False(LegalHoldScope.Covers(
            [Hold(orderId: Guid.NewGuid())], HeldRecordType.OrderEvent, null, Guid.NewGuid()));
    }

    [Fact]
    public void AHoldWithNoOrderCoversEveryOrderInItsScope()
    {
        // A null on the hold widens rather than narrows: "this restaurant's order events", all of
        // them, is a thing an investigation asks for.
        var restaurantId = Guid.NewGuid();

        Assert.True(LegalHoldScope.Covers(
            [Hold(restaurantId: restaurantId)], HeldRecordType.OrderEvent, restaurantId, Guid.NewGuid()));
    }

    [Fact]
    public void AHoldDoesNotReachAcrossRecordTypes()
    {
        // A hold on order events is not a statement about payment evidence.
        Assert.False(LegalHoldScope.Covers(
            [Hold(HeldRecordType.OrderEvent)], HeldRecordType.PaymentEvent, null, null));
    }

    [Fact]
    public void AHoldNamingARestaurantDoesNotCoverAnother()
    {
        Assert.False(LegalHoldScope.Covers(
            [Hold(restaurantId: Guid.NewGuid())], HeldRecordType.OrderEvent, Guid.NewGuid(), null));
    }

    [Fact]
    public void AReleasedHoldIsNoLongerActive()
    {
        var hold = Hold();
        hold.ReleasedAt = Now;

        Assert.False(hold.IsActive(Now));
        Assert.True(Hold().IsActive(Now));
    }

    [Fact]
    public void AnArchiveIsOnlyVerifiedWhenBothTheChecksumAndTheCountAgree()
    {
        // A checksum alone passes on an empty file whose manifest also says empty, which is exactly
        // what a restore drill exists to catch.
        var content = "{\"a\":1}\n{\"a\":2}";
        var manifest = new RetentionArchiveManifest(
            HeldRecordType.OrderEvent, 2, Now, Now, RetentionArchive.Checksum(content), Now, "x.jsonl");

        Assert.True(RetentionArchive.Verifies(manifest, content));
        Assert.False(RetentionArchive.Verifies(manifest with { RowCount = 3 }, content));
        Assert.False(RetentionArchive.Verifies(manifest, content + "\n{\"a\":3}"));
    }

    [Fact]
    public void AnArchiveNamesWhatIsInsideWithoutBeingOpened()
    {
        var name = RetentionArchive.FileNameFor(HeldRecordType.PaymentEvent, Now, Now.AddDays(-2_555));

        Assert.Contains("PaymentEvent", name, StringComparison.Ordinal);
        Assert.Contains("20260821", name, StringComparison.Ordinal);
        Assert.EndsWith(".jsonl", name, StringComparison.Ordinal);
    }

    [Fact]
    public void ARetentionRunIsItsOwnProcessRatherThanSomethingTheApiDoes()
    {
        // The policy is explicit that the web runtime's role must stay unable to mutate report rows.
        // A hosted service inside the API would need exactly the grant the policy withholds.
        var program = Source("Program.cs");

        Assert.Contains("--retention", program, StringComparison.Ordinal);
        Assert.Contains("--retention-restore-drill", program, StringComparison.Ordinal);
        Assert.DoesNotContain("AddHostedService<ReportRetentionMaintenance>", program, StringComparison.Ordinal);
    }

    [Fact]
    public void ARunWithNowhereToArchiveRefusesRatherThanDeleting()
    {
        // A run that archives somewhere nobody chose is indistinguishable from one that deletes
        // without archiving.
        var program = Source("Program.cs");
        var guard = program.IndexOf("ReportRetention__ArchiveDestination is not set", StringComparison.Ordinal);

        Assert.True(guard >= 0, "A missing archive destination does not stop the run.");
    }

    [Fact]
    public void DeletionIsDeclaredToTheDatabaseRatherThanSlippedPastIt()
    {
        var source = Source(Path.Combine("Services", "ReportRetentionMaintenance.cs"));

        Assert.Contains("dineflow.retention_maintenance", source, StringComparison.Ordinal);
        Assert.Contains("SET LOCAL", source, StringComparison.Ordinal);
    }

    [Fact]
    public void EditingReportEvidenceStaysImpossibleEvenForARetentionRun()
    {
        // Retention removes evidence whose period has run out. It never edits it, and no flag
        // should make that possible.
        var trigger = System.IO.File.ReadAllText(MigrationPath("20260821063000_AllowRetentionDeletes.cs"));
        var exemption = trigger.IndexOf("RETURN OLD", StringComparison.Ordinal);

        Assert.True(exemption >= 0);
        Assert.Contains("TG_OP = 'DELETE'", trigger[..exemption], StringComparison.Ordinal);
    }

    private static string Source(string relativePath) =>
        System.IO.File.ReadAllText(Path.Combine(ApiRoot(), relativePath));

    private static string MigrationPath(string file) =>
        Path.Combine(RepositoryRoot(), "DineFlow.Infrastructure", "Migrations", file);

    private static string ApiRoot() => Path.Combine(RepositoryRoot(), "DineFlow.Api");

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !System.IO.File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
