namespace DineFlow.Infrastructure.Messaging;

/// <summary>
/// How hard, and for how long, a transactional email is retried.
/// </summary>
/// <remarks>
/// <para>
/// The schedule backs off because the failures worth retrying are transient by definition — a
/// provider rate limit, a network blip, a five-minute outage. Retrying a hard bounce is pointless
/// and retrying it quickly is worse: it burns the sending reputation the other emails depend on.
/// </para>
/// <para>
/// It also ends. An unbounded queue that keeps trying forever is how a dead address turns into
/// permanent load nobody notices, so the budget runs out, the row is dead-lettered, and that is a
/// visible state a person can be alerted on rather than a log line among thousands.
/// </para>
/// </remarks>
public static class EmailDeliveryPolicy
{
    /// <summary>
    /// Waits before each retry. Roughly nine hours in total: long enough to ride out a provider
    /// incident, short enough that a refund notice is not delivered a week late.
    /// </summary>
    public static readonly IReadOnlyList<TimeSpan> RetryDelays =
    [
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(15),
        TimeSpan.FromHours(1),
        TimeSpan.FromHours(3),
        TimeSpan.FromHours(5),
    ];

    /// <summary>Attempts before the row is given up on — the first try plus every retry.</summary>
    public static int MaximumAttempts => RetryDelays.Count + 1;

    /// <summary>
    /// When to try again after <paramref name="attemptCount"/> failures, or null when the budget
    /// has run out and the row should be dead-lettered.
    /// </summary>
    public static DateTime? NextAttemptAt(int attemptCount, DateTime now)
    {
        if (attemptCount < 1 || attemptCount > RetryDelays.Count)
        {
            return null;
        }

        return now + RetryDelays[attemptCount - 1];
    }

    public static bool IsExhausted(int attemptCount) => attemptCount >= MaximumAttempts;

    /// <summary>
    /// Whether a provider failure is worth trying again.
    /// </summary>
    /// <remarks>
    /// Conservative on purpose: anything not recognisably permanent is retried, because a
    /// transactional email dropped on a misread error is invisible, while one sent twice is merely
    /// annoying. Only the failures a provider states as final are treated as final.
    /// </remarks>
    public static bool IsPermanentFailure(string? providerError)
    {
        if (string.IsNullOrWhiteSpace(providerError))
        {
            return false;
        }

        return PermanentSignals.Any(signal =>
            providerError.Contains(signal, StringComparison.OrdinalIgnoreCase));
    }

    private static readonly string[] PermanentSignals =
    [
        "invalid email",
        "invalid recipient",
        "does not exist",
        "no such user",
        "mailbox unavailable",
        "recipient rejected",
        "550 5.1.1",
        "unsubscribed",
        "suppressed",
    ];
}
