using Microsoft.Extensions.Caching.Memory;

namespace DineFlow.Api.Services;

/// <summary>
/// Counts rejected cart participant tokens per source, and shuts a source out once it has produced
/// far more failures than a person ever could.
///
/// <para>
/// A cart participant token is the whole credential for a public cart — no password, no account.
/// Nothing capped how fast one source could try them: eighty invalid tokens in a burst were each
/// answered with a plain 401, as fast as they could be sent.
/// </para>
///
/// <para>
/// This counts failures rather than requests, which is the only version of the rule that can be set
/// tightly. Cart pages poll every couple of seconds, so a restaurant whose diners share one wifi
/// connection produces hundreds of legitimate cart requests a minute from one address — a cap on
/// requests strict enough to stop guessing would take the venue offline. Successful requests never
/// touch this budget, and a guess is never anything but a failure.
/// </para>
/// </summary>
public sealed class CartTokenFailureTracker(IMemoryCache cache, ILogger<CartTokenFailureTracker> logger)
{
    /// <summary>
    /// How many rejected tokens one source may produce before it is shut out. A person meets this
    /// only by holding a stale token, and their client stops after the first 401; a script meets it
    /// in under a second.
    /// </summary>
    public const int FailureLimit = 20;

    /// <summary>How long failures are remembered, and how long a shut-out source stays shut out.</summary>
    public static readonly TimeSpan Window = TimeSpan.FromMinutes(5);

    /// <summary>True when this source has already spent its budget of rejected tokens.</summary>
    public bool IsLockedOut(string source) => Failures(source) >= FailureLimit;

    /// <summary>
    /// Records one rejected token. Returns true when this is the failure that spends the budget, so
    /// the caller can log the transition once rather than on every attempt that follows.
    /// </summary>
    public bool RecordFailure(string source)
    {
        var failures = Failures(source) + 1;

        // Absolute rather than sliding: a sliding window would let a patient attacker hold the
        // entry alive indefinitely, and would never let an honest client back in either.
        cache.Set(KeyFor(source), failures, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = Window,
            Size = 1
        });

        if (failures == FailureLimit)
        {
            logger.LogWarning(
                "Cart participant tokens from {Source} were rejected {Failures} times within {Window}; "
                    + "further cart access from this source is refused until the window passes.",
                source,
                failures,
                Window);

            return true;
        }

        return false;
    }

    /// <summary>Forgets a source's failures — used once it proves it holds a real token.</summary>
    public void Clear(string source) => cache.Remove(KeyFor(source));

    private int Failures(string source) =>
        cache.TryGetValue(KeyFor(source), out int failures) ? failures : 0;

    private static string KeyFor(string source) => $"cart-token-failures:{source}";
}
