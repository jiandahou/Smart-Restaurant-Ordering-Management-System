using DineFlow.Api.Services;
using DineFlow.Infrastructure.Reporting;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The retention periods were published by the policy endpoint and enforced by nothing: rows
/// accumulated indefinitely, and the "legal hold register" was a configuration string nothing read.
/// Keeping personal data past its stated period is the same kind of failure as deleting it early,
/// and the published figure was a promise the platform could not evidence.
///
/// <para>
/// These run against real PostgreSQL because the delete goes through raw SQL — the change tracker
/// refuses to delete report rows, and that refusal is the guarantee this job is the exception to.
/// </para>
/// </summary>
public sealed class ReportRetentionEnforcementTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private string _archive = string.Empty;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        _archive = Path.Combine(Path.GetTempPath(), $"dineflow-retention-{Guid.NewGuid():N}");
    }

    public async Task DisposeAsync()
    {
        if (Directory.Exists(_archive))
        {
            Directory.Delete(_archive, recursive: true);
        }

        await _database.DisposeAsync();
    }

    private static readonly DateTime Now = new(2026, 8, 21, 0, 0, 0, DateTimeKind.Utc);

    private ReportRetentionMaintenance Maintenance(IRetentionArchiveStore? store = null) =>
        new(
            _database.CreateContext(),
            store ?? new FileSystemRetentionArchiveStore(),
            NullLogger<ReportRetentionMaintenance>.Instance);

    /// <summary>
    /// A store whose read-back disagrees with what was written — a truncated upload that reported
    /// success, which is the one failure mode that turns retention into data loss.
    /// </summary>
    private sealed class CorruptingArchiveStore : IRetentionArchiveStore
    {
        private readonly FileSystemRetentionArchiveStore _real = new();

        public Task WriteAsync(string directory, string fileName, string content, CancellationToken cancellationToken) =>
            _real.WriteAsync(directory, fileName, content, cancellationToken);

        public Task<string> ReadAsync(string directory, string fileName, CancellationToken cancellationToken) =>
            Task.FromResult("truncated");
    }

    private async Task<Guid> AddOrderEventAsync(DateTime createdAt, Guid? restaurantId = null, Guid? orderId = null)
    {
        await using var dbContext = _database.CreateContext();
        var row = new OrderEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            OrderId = orderId ?? Guid.NewGuid(),
            EventType = "order.created",
            Message = "Placed.",
            CreatedAt = createdAt,
        };

        dbContext.OrderEventLogs.Add(row);
        await dbContext.SaveChangesAsync();
        return row.Id;
    }

    [RequiresPostgresFact]
    public async Task EvidencePastItsRetentionPeriodIsActuallyDeleted()
    {
        await AddOrderEventAsync(Now.AddDays(-ReportRetentionSchedule.OrderEventRetentionDays - 1));

        await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None);

        await using var reread = _database.CreateContext();
        Assert.Equal(0, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task EvidenceStillInsideItsPeriodIsLeftAlone()
    {
        // Deleting early is the same failure in the other direction.
        await AddOrderEventAsync(Now.AddDays(-ReportRetentionSchedule.OrderEventRetentionDays + 1));

        await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None);

        await using var reread = _database.CreateContext();
        Assert.Equal(1, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task NothingIsDeletedBeforeItHasBeenArchived()
    {
        await AddOrderEventAsync(Now.AddDays(-1_000));

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        Assert.NotNull(outcome.ArchiveFile);

        var archived = await File.ReadAllTextAsync(Path.Combine(_archive, outcome.ArchiveFile!));

        Assert.Equal(1, RetentionArchive.CountRows(archived));
        Assert.Equal(outcome.Sha256, RetentionArchive.Checksum(archived));
    }

    [RequiresPostgresFact]
    public async Task TheArchiveCarriesTheCountsAndRangeThePolicyAsksFor()
    {
        await AddOrderEventAsync(Now.AddDays(-1_000));
        await AddOrderEventAsync(Now.AddDays(-900));

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);
        var manifest = await File.ReadAllTextAsync(
            Path.Combine(_archive, $"{outcome.ArchiveFile}.manifest.json"));

        Assert.Contains("\"RowCount\": 2", manifest, StringComparison.Ordinal);
        Assert.Contains("EarliestCreatedAt", manifest, StringComparison.Ordinal);
        Assert.Contains("LatestCreatedAt", manifest, StringComparison.Ordinal);
        Assert.Contains("Sha256", manifest, StringComparison.Ordinal);
    }

    [RequiresPostgresFact]
    public async Task EvidenceUnderLegalHoldSurvivesItsRetentionPeriod()
    {
        // The register used to be a configuration string nothing read, so a run would have deleted
        // held evidence and the only sign would have been the absence of rows.
        var orderId = Guid.NewGuid();
        await AddOrderEventAsync(Now.AddDays(-1_000), orderId: orderId);

        await using (var dbContext = _database.CreateContext())
        {
            dbContext.LegalHolds.Add(new LegalHold
            {
                Id = Guid.NewGuid(),
                RecordType = HeldRecordType.OrderEvent,
                OrderId = orderId,
                Reason = "Disputed charge under review.",
                PlacedBy = "compliance@dineflow.test",
                PlacedAt = Now.AddDays(-10),
            });
            await dbContext.SaveChangesAsync();
        }

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        await using var reread = _database.CreateContext();

        Assert.Equal(1, outcome.HeldBack);
        Assert.Equal(0, outcome.Deleted);
        Assert.Equal(1, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task AReleasedHoldStopsProtectingAnything()
    {
        var orderId = Guid.NewGuid();
        await AddOrderEventAsync(Now.AddDays(-1_000), orderId: orderId);

        await using (var dbContext = _database.CreateContext())
        {
            dbContext.LegalHolds.Add(new LegalHold
            {
                Id = Guid.NewGuid(),
                RecordType = HeldRecordType.OrderEvent,
                OrderId = orderId,
                Reason = "Closed.",
                PlacedBy = "compliance@dineflow.test",
                PlacedAt = Now.AddDays(-100),
                ReleasedAt = Now.AddDays(-1),
                ReleasedBy = "compliance@dineflow.test",
            });
            await dbContext.SaveChangesAsync();
        }

        await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None);

        await using var reread = _database.CreateContext();
        Assert.Equal(0, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task AHoldOnOneOrderDoesNotFreezeEverybodyElsesEvidence()
    {
        // A hold that is too expensive to place is a hold nobody places.
        var held = Guid.NewGuid();
        await AddOrderEventAsync(Now.AddDays(-1_000), orderId: held);
        await AddOrderEventAsync(Now.AddDays(-1_000), orderId: Guid.NewGuid());

        await using (var dbContext = _database.CreateContext())
        {
            dbContext.LegalHolds.Add(new LegalHold
            {
                Id = Guid.NewGuid(),
                RecordType = HeldRecordType.OrderEvent,
                OrderId = held,
                Reason = "One dispute.",
                PlacedBy = "compliance@dineflow.test",
                PlacedAt = Now.AddDays(-10),
            });
            await dbContext.SaveChangesAsync();
        }

        await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None);

        await using var reread = _database.CreateContext();
        Assert.Equal(1, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task ADryRunArchivesAndDeletesNothing()
    {
        // The rehearsal an operator does before letting this loose on seven years of evidence.
        await AddOrderEventAsync(Now.AddDays(-1_000));

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: true, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        await using var reread = _database.CreateContext();

        Assert.Equal(1, outcome.Archived);
        Assert.Equal(0, outcome.Deleted);
        Assert.Equal(1, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task AnArchiveThatDoesNotMatchItsManifestStopsTheDeletion()
    {
        // The guard between retention and data loss. Nothing exercised it until the archive store
        // became something a test could make lie.
        await AddOrderEventAsync(Now.AddDays(-1_000));

        var outcome = (await Maintenance(new CorruptingArchiveStore())
                .RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        await using var reread = _database.CreateContext();

        Assert.Equal(0, outcome.Deleted);
        Assert.Equal(1, await reread.OrderEventLogs.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task ATamperedArchiveIsCaughtByTheNextRestoreDrill()
    {
        // The other half: an archive that was fine when written and is not fine now.
        await AddOrderEventAsync(Now.AddDays(-1_000));

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        await File.WriteAllTextAsync(Path.Combine(_archive, outcome.ArchiveFile!), "tampered");

        var results = await new RetentionRestoreDrill(NullLogger<RetentionRestoreDrill>.Instance)
            .RunAsync(_archive, CancellationToken.None);

        Assert.False(Assert.Single(results).Verified);
    }

    [RequiresPostgresFact]
    public async Task ARestoreDrillReadsTheArchiveBackAndSaysSo()
    {
        // A backup nobody has read back is a hypothesis. The old evidence for this was a date
        // somebody typed into configuration.
        await AddOrderEventAsync(Now.AddDays(-1_000));
        await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None);

        var results = await new RetentionRestoreDrill(NullLogger<RetentionRestoreDrill>.Instance)
            .RunAsync(_archive, CancellationToken.None);

        var result = Assert.Single(results);

        Assert.True(result.Verified);
        Assert.Equal(1, result.RowCount);
    }

    [RequiresPostgresFact]
    public async Task AManifestWithNoArchiveBesideItFailsTheDrill()
    {
        // The failure that looks most like success: the paperwork is all there.
        await AddOrderEventAsync(Now.AddDays(-1_000));

        var outcome = (await Maintenance().RunAsync(_archive, Now, dryRun: false, CancellationToken.None))
            .Single(result => result.RecordType == HeldRecordType.OrderEvent);

        File.Delete(Path.Combine(_archive, outcome.ArchiveFile!));

        var results = await new RetentionRestoreDrill(NullLogger<RetentionRestoreDrill>.Instance)
            .RunAsync(_archive, CancellationToken.None);

        Assert.False(Assert.Single(results).Verified);
    }
}
