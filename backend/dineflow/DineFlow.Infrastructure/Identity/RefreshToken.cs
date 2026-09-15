namespace DineFlow.Infrastructure.Identity;

/// <summary>
/// A long-lived, rotating credential that lets the client obtain a new short-lived
/// JWT without re-entering credentials. Only a SHA-256 hash of the raw token is
/// stored — the raw value exists only in the response body and the client's
/// storage, never at rest server-side (same principle as password hashing).
/// </summary>
public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string UserId { get; set; } = string.Empty;

    /// <summary>
    /// The sign-in this token belongs to. Every rotation carries it forward, so one session is one
    /// chain of tokens.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Replaying a token that has already been rotated is the signature of a stolen copy, and the
    /// answer is to kill the family it belongs to — nobody can tell which of the two holders is the
    /// owner, so both are made to sign in again. The family used to be every token the account
    /// held, which is wider than the reasoning supports: a phone that woke with a stale token
    /// signed out the till, the tablet and the office laptop with it.
    /// </para>
    /// <para>
    /// Scoped to the sign-in, the same rule stops exactly what it is aimed at. A thief holding a
    /// copy of one session's token loses that session, and the devices that were never involved
    /// keep working — which is what a person means when they say they were not the one who logged
    /// out.
    /// </para>
    /// </remarks>
    public Guid SessionId { get; set; } = Guid.NewGuid();

    public ApplicationUser User { get; set; } = null!;

    public string TokenHash { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public string? CreatedByIp { get; set; }

    public DateTime? RevokedAt { get; set; }

    public string? RevokedByIp { get; set; }

    /// <summary>Hash of the token this one was rotated into, so a replayed
    /// (already-rotated) token can be traced and its whole family revoked.</summary>
    public string? ReplacedByTokenHash { get; set; }
}
