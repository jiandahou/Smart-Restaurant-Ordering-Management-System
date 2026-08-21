namespace DineFlow.Infrastructure.Identity;

/// <summary>
/// How a privacy request moves from received to answered.
/// </summary>
/// <remarks>
/// <para>
/// The status was a free string defaulting to "Received", and nothing could change it, because there
/// was no way for anyone to act on a request at all: a customer could file one and it landed in a
/// table nobody was shown. A request to see or delete your own personal information is not a support
/// ticket the business may leave unread — under the Privacy Act it carries a deadline, and silence
/// is the failure mode.
/// </para>
/// <para>
/// Stated here so the endpoint that changes a status and the screen that offers the buttons cannot
/// disagree about which moves exist.
/// </para>
/// </remarks>
public static class PrivacyRequestWorkflow
{
    public const string Received = "Received";
    public const string InProgress = "InProgress";
    public const string Completed = "Completed";
    public const string Declined = "Declined";

    public static readonly IReadOnlyList<string> All = [Received, InProgress, Completed, Declined];

    /// <summary>Answered one way or the other; nothing further happens to it.</summary>
    public static bool IsClosed(string status) =>
        string.Equals(status, Completed, StringComparison.Ordinal)
        || string.Equals(status, Declined, StringComparison.Ordinal);

    /// <summary>
    /// Australian privacy law gives thirty days to answer an access or correction request. The
    /// product is not the lawyer, but it is the only thing that knows the clock started.
    /// </summary>
    public static readonly TimeSpan ResponseDeadline = TimeSpan.FromDays(30);

    public static bool IsOverdue(string status, DateTime createdAtUtc, DateTime utcNow) =>
        !IsClosed(status) && utcNow - createdAtUtc > ResponseDeadline;

    /// <summary>Days left to answer, negative once the deadline has passed, null once closed.</summary>
    public static int? DaysRemaining(string status, DateTime createdAtUtc, DateTime utcNow) =>
        IsClosed(status)
            ? null
            : (int)Math.Ceiling((createdAtUtc + ResponseDeadline - utcNow).TotalDays);

    /// <summary>Why a move was refused, or null when it is allowed.</summary>
    public static string? Refuse(string current, string next)
    {
        if (!All.Contains(next, StringComparer.Ordinal))
        {
            return $"Status must be one of {string.Join(", ", All)}.";
        }

        if (string.Equals(current, next, StringComparison.Ordinal))
        {
            return "This request is already in that state.";
        }

        // Reopening a closed request would let an answer already given to a person be quietly taken
        // back. If more is needed, that is a new request, with its own clock.
        if (IsClosed(current))
        {
            return "This request has been answered and cannot be reopened. Ask the customer to file a new request.";
        }

        if (string.Equals(next, Received, StringComparison.Ordinal))
        {
            return "A request cannot be moved back to Received.";
        }

        return null;
    }
}
