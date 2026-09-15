namespace DineFlow.Api.Services;

/// <summary>
/// Builds the pattern for a "contains" search.
///
/// <para>
/// <c>%</c> and <c>_</c> are wildcards to LIKE, so interpolating what someone typed straight into
/// <c>$"%{search}%"</c> handed them the wildcards. Searching the user directory for <c>_</c>
/// produced <c>%_%</c> — any string of at least one character — and returned every account on the
/// platform instead of the ones containing an underscore. Nothing here was ever an injection risk,
/// since the pattern is a parameter; the search simply answered a different question than the one
/// asked.
/// </para>
/// </summary>
public static class SearchPattern
{
    /// <summary>Passed to ILike so PostgreSQL knows which character undoes a wildcard.</summary>
    public const string EscapeCharacter = "\\";

    /// <summary>A pattern matching rows that contain <paramref name="value"/> literally.</summary>
    public static string Contains(string value) => $"%{Escape(value)}%";

    private static string Escape(string value) => value
        // The escape character itself goes first, or the escapes added below get escaped again.
        .Replace("\\", "\\\\")
        .Replace("%", "\\%")
        .Replace("_", "\\_");
}
