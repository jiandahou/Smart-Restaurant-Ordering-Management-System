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

    /// <summary>
    /// The token was rotated away moments ago and is being presented again — two tabs of the same
    /// browser waking together and both refreshing the token they share.
    /// </summary>
    /// <remarks>
    /// Distinct from <see cref="Reused"/> because the response is the opposite: nothing is revoked,
    /// and the client is told to read the token its sibling has by now written and try again. A till
    /// signed out mid-service stops showing new orders, stops sounding, and stops printing — orders
    /// are not lost from the database, but they are lost from anybody's attention, which is the same
    /// thing to the customer waiting for food.
    /// </remarks>
    RotationRace,
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
/// token revokes the token family, since that pattern only happens if a stolen
/// token and the legitimate client both try to use it.
/// </summary>
/// <remarks>
/// The family is one sign-in: a login opens a session and every rotation from it carries the same
/// session id. So a replay ends the session it was replayed against, and the account's other
/// devices — which never held that token and are not under suspicion — stay signed in. Ending them
/// all is a separate, deliberate act: <see cref="IRefreshTokenService.RevokeAllForUserAsync"/>.
/// </remarks>
public interface IRefreshTokenService
{
    Task<string> IssueAsync(string userId, string? ipAddress, CancellationToken cancellationToken = default);

    Task<RefreshTokenRotationResult> RotateAsync(
        string rawToken,
        string? ipAddress,
        CancellationToken cancellationToken = default);

    Task RevokeAsync(string rawToken, string? ipAddress, CancellationToken cancellationToken = default);

    /// <summary>
    /// Ends every session for this account. Used when the account's identity changes underneath
    /// sessions that were issued against the old one.
    /// </summary>
    Task RevokeAllForUserAsync(string userId, string? ipAddress, CancellationToken cancellationToken = default);
}
