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
