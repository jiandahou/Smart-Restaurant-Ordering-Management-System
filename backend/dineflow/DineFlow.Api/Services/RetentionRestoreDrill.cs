using System.Text.Json;
using DineFlow.Infrastructure.Reporting;

namespace DineFlow.Api.Services;

/// <summary>What one restore drill found.</summary>
public sealed record RestoreDrillResult(string File, bool Verified, int RowCount, string? Problem);

/// <summary>
/// Reads archives back and checks they are what their manifests say.
/// </summary>
/// <remarks>
/// <para>
/// The policy required a restore drill within the last year, and the evidence for it was a date in
/// configuration that a human typed. A backup nobody has read back is a hypothesis; the whole point
/// of the drill is to convert it into a fact, and a date field cannot do that.
/// </para>
/// <para>
/// Deliberately dumb: read the file, read the manifest, compare. The value is in it being run, not
/// in it being clever.
/// </para>
/// </remarks>
public sealed class RetentionRestoreDrill(ILogger<RetentionRestoreDrill> logger)
{
    public async Task<IReadOnlyList<RestoreDrillResult>> RunAsync(
        string archiveDirectory,
        CancellationToken cancellationToken)
    {
        if (!Directory.Exists(archiveDirectory))
        {
            logger.LogError("No archive directory at {Directory}. Nothing to drill against.", archiveDirectory);
            return [];
        }

        var results = new List<RestoreDrillResult>();

        foreach (var manifestPath in Directory.EnumerateFiles(archiveDirectory, "*.manifest.json").Order())
        {
            results.Add(await DrillAsync(manifestPath, cancellationToken));
        }

        if (results.Count == 0)
        {
            logger.LogWarning("No archives found in {Directory}. A drill against nothing proves nothing.", archiveDirectory);
        }

        return results;
    }

    private async Task<RestoreDrillResult> DrillAsync(string manifestPath, CancellationToken cancellationToken)
    {
        var archivePath = manifestPath[..^".manifest.json".Length];
        var name = Path.GetFileName(archivePath);

        RetentionArchiveManifest? manifest;

        try
        {
            manifest = JsonSerializer.Deserialize<RetentionArchiveManifest>(
                await File.ReadAllTextAsync(manifestPath, cancellationToken));
        }
        catch (Exception error)
        {
            logger.LogError(error, "Could not read the manifest for {File}.", name);
            return new RestoreDrillResult(name, false, 0, "the manifest could not be read");
        }

        if (manifest is null)
        {
            return new RestoreDrillResult(name, false, 0, "the manifest was empty");
        }

        if (!File.Exists(archivePath))
        {
            // A manifest with no archive beside it is the failure that looks most like success:
            // the paperwork is all there.
            logger.LogError("{File} is described by a manifest but is not in the archive.", name);
            return new RestoreDrillResult(name, false, 0, "the archive itself is missing");
        }

        var content = await File.ReadAllTextAsync(archivePath, cancellationToken);

        if (!RetentionArchive.Verifies(manifest, content))
        {
            logger.LogError(
                "{File} does not match its manifest: {Expected} rows / {Sha} expected.",
                name, manifest.RowCount, manifest.Sha256);
            return new RestoreDrillResult(name, false, RetentionArchive.CountRows(content), "checksum or row count mismatch");
        }

        logger.LogInformation("{File} verified: {Rows} rows, {Sha}.", name, manifest.RowCount, manifest.Sha256);
        return new RestoreDrillResult(name, true, manifest.RowCount, null);
    }
}
