using System.Text.Json;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>What one retention run did to one body of evidence.</summary>
public sealed record RetentionOutcome(
    HeldRecordType RecordType,
    DateTime Cutoff,
    int Eligible,
    int HeldBack,
    int Archived,
    int Deleted,
    string? ArchiveFile,
    string? Sha256);

/// <summary>
/// Archives and then deletes report evidence that is past its stated retention period.
/// </summary>
/// <remarks>
/// <para>
/// The retention periods were published by the policy endpoint and enforced by nothing. Rows
/// accumulated indefinitely, which is not a harmless overshoot: keeping personal data past its
/// stated period is the same kind of failure as deleting it early, and the published figure was a
/// promise the platform could not evidence.
/// </para>
/// <para>
/// Deliberately not a hosted service. The policy is explicit that the web runtime's database role
/// must remain unable to mutate report rows — the change tracker refuses it and so should the
/// grant — so this runs as its own process, under its own credentials, from the
/// <c>--retention</c> release task.
/// </para>
/// <para>
/// Archive, verify, then delete, in that order and never in another. Deleting first and archiving
/// afterwards would be a data-loss bug one crash wide.
/// </para>
/// </remarks>
public sealed class ReportRetentionMaintenance(
    AppDbContext dbContext,
    IRetentionArchiveStore archiveStore,
    ILogger<ReportRetentionMaintenance> logger)
{
    /// <summary>
    /// Runs one pass over every record type.
    /// </summary>
    /// <param name="archiveDirectory">
    /// Where the archive files are written. A directory rather than an object-store client on
    /// purpose: the deployment mounts encrypted, lifecycle-managed storage here, so the credentials
    /// for it never enter this process.
    /// </param>
    /// <param name="dryRun">Report what would happen and delete nothing.</param>
    public async Task<IReadOnlyList<RetentionOutcome>> RunAsync(
        string archiveDirectory,
        DateTime now,
        bool dryRun,
        CancellationToken cancellationToken)
    {
        var activeHolds = await dbContext.Set<LegalHold>()
            .Where(hold => hold.ReleasedAt == null && hold.PlacedAt <= now)
            .ToListAsync(cancellationToken);

        var outcomes = new List<RetentionOutcome>();

        foreach (var recordType in ReportRetentionSchedule.AllRecordTypes)
        {
            outcomes.Add(await RunForAsync(recordType, activeHolds, archiveDirectory, now, dryRun, cancellationToken));
        }

        return outcomes;
    }

    private async Task<RetentionOutcome> RunForAsync(
        HeldRecordType recordType,
        IReadOnlyList<LegalHold> activeHolds,
        string archiveDirectory,
        DateTime now,
        bool dryRun,
        CancellationToken cancellationToken)
    {
        var cutoff = ReportRetentionSchedule.CutoffFor(recordType, now);
        var rows = await LoadExpiredAsync(recordType, cutoff, cancellationToken);

        var releasable = rows
            .Where(row => !LegalHoldScope.Covers(activeHolds, recordType, row.RestaurantId, row.OrderId))
            .ToList();
        var heldBack = rows.Count - releasable.Count;

        if (releasable.Count == 0)
        {
            logger.LogInformation(
                "{RecordType}: nothing past {Cutoff:yyyy-MM-dd} to release ({Held} under legal hold).",
                recordType, cutoff, heldBack);
            return new RetentionOutcome(recordType, cutoff, rows.Count, heldBack, 0, 0, null, null);
        }

        var writtenAt = now;
        var content = RetentionArchive.Serialize(releasable.Select(row => row.Payload));
        var manifest = new RetentionArchiveManifest(
            recordType,
            releasable.Count,
            releasable.Min(row => row.CreatedAt),
            releasable.Max(row => row.CreatedAt),
            RetentionArchive.Checksum(content),
            writtenAt,
            RetentionArchive.FileNameFor(recordType, writtenAt, cutoff));

        await archiveStore.WriteAsync(archiveDirectory, manifest.FileName, content, cancellationToken);
        await archiveStore.WriteAsync(
            archiveDirectory,
            $"{manifest.FileName}.manifest.json",
            JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }),
            cancellationToken);

        // Read back before deleting. A write that reported success and produced a truncated file is
        // the one failure mode that turns retention into data loss, and it is silent by nature.
        var readBack = await archiveStore.ReadAsync(archiveDirectory, manifest.FileName, cancellationToken);

        if (!RetentionArchive.Verifies(manifest, readBack))
        {
            logger.LogError(
                "{RecordType}: the archive {File} does not match its manifest. Nothing was deleted.",
                recordType, manifest.FileName);
            return new RetentionOutcome(recordType, cutoff, rows.Count, heldBack, 0, 0, manifest.FileName, manifest.Sha256);
        }

        if (dryRun)
        {
            logger.LogInformation(
                "{RecordType}: {Count} rows archived to {File}; nothing deleted (dry run).",
                recordType, releasable.Count, manifest.FileName);
            return new RetentionOutcome(recordType, cutoff, rows.Count, heldBack, releasable.Count, 0, manifest.FileName, manifest.Sha256);
        }

        var deleted = await DeleteAsync(recordType, releasable.Select(row => row.Id).ToArray(), cancellationToken);

        logger.LogInformation(
            "{RecordType}: {Deleted} rows deleted after archiving to {File} ({Sha}). {Held} left under legal hold.",
            recordType, deleted, manifest.FileName, manifest.Sha256, heldBack);

        return new RetentionOutcome(recordType, cutoff, rows.Count, heldBack, releasable.Count, deleted, manifest.FileName, manifest.Sha256);
    }

    private sealed record ExpiredRow(Guid Id, Guid? RestaurantId, Guid? OrderId, DateTime CreatedAt, object Payload);

    private async Task<List<ExpiredRow>> LoadExpiredAsync(
        HeldRecordType recordType,
        DateTime cutoff,
        CancellationToken cancellationToken) => recordType switch
    {
        HeldRecordType.AuditLog => (await dbContext.AuditLogs
            .AsNoTracking()
            .Where(row => row.CreatedAt < cutoff)
            .ToListAsync(cancellationToken))
            .Select(row => new ExpiredRow(row.Id, row.RestaurantId, null, row.CreatedAt, row))
            .ToList(),
        HeldRecordType.OrderEvent => (await dbContext.OrderEventLogs
            .AsNoTracking()
            .Where(row => row.CreatedAt < cutoff)
            .ToListAsync(cancellationToken))
            .Select(row => new ExpiredRow(row.Id, row.RestaurantId, row.OrderId, row.CreatedAt, row))
            .ToList(),
        HeldRecordType.PaymentEvent => (await dbContext.PaymentEventLogs
            .AsNoTracking()
            .Where(row => row.CreatedAt < cutoff)
            .ToListAsync(cancellationToken))
            .Select(row => new ExpiredRow(row.Id, row.RestaurantId, row.OrderId, row.CreatedAt, row))
            .ToList(),
        _ => throw new ArgumentOutOfRangeException(nameof(recordType)),
    };

    /// <summary>
    /// Deletes by raw SQL, because the change tracker refuses to delete report rows at all.
    /// </summary>
    /// <remarks>
    /// That refusal is the application's guarantee and it stays. This process is the exception the
    /// policy describes: a separate run, under a role granted the delete, doing it once a day under
    /// audit rather than a controller doing it whenever it likes.
    /// </remarks>
    private Task<int> DeleteAsync(HeldRecordType recordType, Guid[] ids, CancellationToken cancellationToken)
    {
        // Literal per branch rather than an interpolated table name: the ids are parameterised
        // either way, and a switch over a closed enum is easier to audit than a formatted string.
        var sql = recordType switch
        {
            HeldRecordType.AuditLog => "DELETE FROM \"AuditLogs\" WHERE \"Id\" = ANY({0})",
            HeldRecordType.OrderEvent => "DELETE FROM \"OrderEventLogs\" WHERE \"Id\" = ANY({0})",
            HeldRecordType.PaymentEvent => "DELETE FROM \"PaymentEventLogs\" WHERE \"Id\" = ANY({0})",
            _ => throw new ArgumentOutOfRangeException(nameof(recordType)),
        };

        return DeleteDeclaredAsync(sql, ids, cancellationToken);
    }

    /// <summary>
    /// Declares the transaction a retention run, then deletes.
    /// </summary>
    /// <remarks>
    /// The immutability trigger refuses every delete unless a transaction says outright that it is
    /// a retention run. That is a statement of intent rather than a permission — the permission
    /// boundary is the GRANT, and the web runtime's role does not have it — but it means nothing
    /// removes report evidence by accident, and a deliberate removal is visible in the statement.
    /// <c>SET LOCAL</c> so the declaration dies with the transaction.
    /// </remarks>
    private async Task<int> DeleteDeclaredAsync(string sql, Guid[] ids, CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        await dbContext.Database.ExecuteSqlRawAsync(
            "SET LOCAL \"dineflow.retention_maintenance\" = 'on'",
            cancellationToken);

#pragma warning disable EF1002 // The SQL is one of three literals above; only the ids are data.
        var deleted = await dbContext.Database.ExecuteSqlRawAsync(sql, [ids], cancellationToken);
#pragma warning restore EF1002

        await transaction.CommitAsync(cancellationToken);
        return deleted;
    }
}
