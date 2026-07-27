namespace DineFlow.Application.Authentication;

public enum RefreshTokenFailureReason
{
    None,
    NotFound,
    Expired,
    Reused,
    /// <summary>The token was deliberately revoked (logout), not rotated away —
    /// distinct from <see cref="Reused"/> so the client can show "you're signed
    /// out" instead of the more alarming "this session was compromised".</summary>
    Revoked,
}

public sealed record RefreshTokenRotationResult(
    bool Succeeded,
    string? UserId,
    string? NewRawToken,
    RefreshTokenFailureReason FailureReason)
{
    public static RefreshTokenRotationResult Success(string userId, string newRawToken) =>
        new(true, userId, newRawToken, RefreshTokenFailureReason.None);

    public static RefreshTokenRotationResult Failure(RefreshTokenFailureReason reason) =>
        new(false, null, null, reason);
}

/// <summary>
/// Issues and rotates long-lived refresh tokens so a client can silently obtain a
/// new access token without asking the user to log in again. Tokens rotate on
/// every use (single use, sliding expiration) and reuse of an already-rotated
/// token revokes the whole token family, since that pattern only happens if a
/// stolen token and the legitimate client both try to use it.
/// </summary>
public interface IRefreshTokenService
{
    Task<string> IssueAsync(string userId, string? ipAddress, CancellationToken cancellationToken = default);

    Task<RefreshTokenRotationResult> RotateAsync(
        string rawToken,
        string? ipAddress,
        CancellationToken cancellationToken = default);

    Task RevokeAsync(string rawToken, string? ipAddress, CancellationToken cancellationToken = default);
}
