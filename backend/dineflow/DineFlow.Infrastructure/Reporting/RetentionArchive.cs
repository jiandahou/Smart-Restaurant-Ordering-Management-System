using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace DineFlow.Infrastructure.Reporting;

/// <summary>
/// What was archived, and proof that what came back is what went in.
/// </summary>
/// <remarks>
/// The policy asks for row counts, the timestamp range and a SHA-256 checksum. That trio is what
/// makes an archive evidence rather than a file: without the count you cannot tell a truncated
/// upload from a quiet month, and without the checksum you cannot tell a restored archive from a
/// plausible one.
/// </remarks>
public sealed record RetentionArchiveManifest(
    HeldRecordType RecordType,
    int RowCount,
    DateTime? EarliestCreatedAt,
    DateTime? LatestCreatedAt,
    string Sha256,
    DateTime WrittenAt,
    string FileName);

public static class RetentionArchive
{
    private static readonly JsonSerializerOptions Format = new() { WriteIndented = false };

    /// <summary>One line per row, so a partial file is still readable up to the break.</summary>
    public static string Serialize<T>(IEnumerable<T> rows) =>
        string.Join("\n", rows.Select(row => JsonSerializer.Serialize(row, Format)));

    public static string Checksum(string content) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content))).ToLowerInvariant();

    /// <summary>
    /// Whether an archive read back from storage is byte-for-byte what the manifest describes.
    /// </summary>
    /// <remarks>
    /// Both halves are checked. A checksum alone passes on an empty file whose manifest also says
    /// empty, which is exactly the failure a restore drill exists to catch.
    /// </remarks>
    public static bool Verifies(RetentionArchiveManifest manifest, string content) =>
        Checksum(content) == manifest.Sha256
        && CountRows(content) == manifest.RowCount;

    public static int CountRows(string content) =>
        string.IsNullOrEmpty(content) ? 0 : content.Split('\n').Length;

    /// <summary>A name that sorts by time and says what is inside without opening it.</summary>
    public static string FileNameFor(HeldRecordType recordType, DateTime writtenAt, DateTime cutoff) =>
        $"{writtenAt:yyyyMMdd'T'HHmmss'Z'}-{recordType}-before-{cutoff:yyyyMMdd}.jsonl";
}
