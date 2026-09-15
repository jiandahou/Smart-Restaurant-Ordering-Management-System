using System.Security.Cryptography;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DineFlow.Infrastructure.Authentication;

public class RefreshTokenService : IRefreshTokenService
{
    private readonly AppDbContext _dbContext;
    private readonly JwtOptions _jwtOptions;

    public RefreshTokenService(AppDbContext dbContext, IOptions<JwtOptions> jwtOptions)
    {
        _dbContext = dbContext;
        _jwtOptions = jwtOptions.Value;
    }

    public async Task<string> IssueAsync(string userId, string? ipAddress, CancellationToken cancellationToken = default)
    {
        var rawToken = GenerateRawToken();

        // A sign-in opens a session, and every rotation from here carries the same id. It is what
        // scopes reuse detection below: this device's chain, not the account's every device.
        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = userId,
            SessionId = Guid.NewGuid(),
            TokenHash = Hash(rawToken),
            ExpiresAt = DateTime.UtcNow.AddDays(_jwtOptions.RefreshTokenExpirationDays),
            CreatedByIp = ipAddress,
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        return rawToken;
    }

    public async Task<RefreshTokenRotationResult> RotateAsync(
        string rawToken,
        string? ipAddress,
        CancellationToken cancellationToken = default)
    {
        var tokenHash = Hash(rawToken);

        // Read without tracking: the claim below writes this row through SQL, and a tracked copy
        // would sit in the context afterwards still describing the token as unused — handed back to
        // anything that reads it later in the same request, which is how a rotated token could be
        // reported as still live.
        var existing = await _dbContext.RefreshTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(refreshToken => refreshToken.TokenHash == tokenHash, cancellationToken);

        if (existing is null)
        {
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.NotFound);
        }

        if (existing.RevokedAt is not null)
        {
            if (existing.ReplacedByTokenHash is null)
            {
                // Revoked with no replacement means it was explicitly logged out,
                // not rotated away — an expected, benign outcome. No family-wide
                // revocation needed; the user already chose to end this session.
                return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Revoked);
            }

            // Rotated away and now being presented again. Moments after the rotation this is the
            // owner racing itself — two tabs sharing one stored token, woken by the same expiry —
            // and revoking the account's whole token family for it signs a restaurant's till out
            // mid-service. Later than that, it is the replay this check exists to catch.
            if (RefreshTokenRotationRace.IsRace(existing.RevokedAt.Value, DateTime.UtcNow))
            {
                return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.RotationRace);
            }

            // Kill the session this token belongs to, so both the legitimate and illegitimate
            // holder are forced to log in again. Only this session: the other devices signed in on
            // this account never held the token being replayed, and there is nothing to suspect
            // them of.
            await RevokeSessionAsync(existing.SessionId, ipAddress, cancellationToken);
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Reused);
        }

        if (existing.ExpiresAt <= DateTime.UtcNow)
        {
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Expired);
        }

        var newRawToken = GenerateRawToken();
        var newTokenHash = Hash(newRawToken);
        var rotatedAt = DateTime.UtcNow;

        // The claim, and the whole of it. Reading the row, deciding it was unused and writing it
        // back is three steps, and callers arrive together: several tabs waking on the same expiry
        // all read "not yet rotated", all rotated it, and all were issued a token of their own —
        // one refresh token becoming six, and single-use rotation meaning nothing. Worse, a stolen
        // token replayed alongside the owner's refresh would have succeeded too, and the reuse
        // detection that exists to catch it would never have fired.
        //
        // Whoever moves RevokedAt away from null wins; everybody else affects no rows, re-reads a
        // token that now carries a replacement, and is answered as the race it was.
        var claimed = await _dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "RefreshTokens"
               SET "RevokedAt" = {rotatedAt},
                   "RevokedByIp" = {ipAddress},
                   "ReplacedByTokenHash" = {newTokenHash}
             WHERE "TokenHash" = {tokenHash}
               AND "RevokedAt" IS NULL
            """,
            cancellationToken);

        if (claimed == 0)
        {
            // Somebody else claimed it between the read above and this update. Whether that is a
            // race or a replay is decided by when *they* rotated it, so the row is re-read rather
            // than trusting the stale copy in memory.
            var winner = await _dbContext.RefreshTokens
                .AsNoTracking()
                .FirstOrDefaultAsync(refreshToken => refreshToken.TokenHash == tokenHash, cancellationToken);

            if (winner?.RevokedAt is null)
            {
                return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.NotFound);
            }

            if (RefreshTokenRotationRace.IsRace(winner.RevokedAt.Value, DateTime.UtcNow))
            {
                return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.RotationRace);
            }

            await RevokeSessionAsync(winner.SessionId, ipAddress, cancellationToken);
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Reused);
        }

        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = existing.UserId,
            SessionId = existing.SessionId,
            TokenHash = newTokenHash,
            ExpiresAt = rotatedAt.AddDays(_jwtOptions.RefreshTokenExpirationDays),
            CreatedByIp = ipAddress,
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        return RefreshTokenRotationResult.Success(existing.UserId, newRawToken);
    }

    public async Task RevokeAsync(string rawToken, string? ipAddress, CancellationToken cancellationToken = default)
    {
        var tokenHash = Hash(rawToken);
        var existing = await _dbContext.RefreshTokens
            .FirstOrDefaultAsync(refreshToken => refreshToken.TokenHash == tokenHash, cancellationToken);

        if (existing is null || existing.RevokedAt is not null)
        {
            return;
        }

        existing.RevokedAt = DateTime.UtcNow;
        existing.RevokedByIp = ipAddress;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Ends every session the account holds. Deliberate, and asked for: a password change, a
    /// "sign out everywhere". Reuse detection does not come through here — it takes the session.
    /// </summary>
    public Task RevokeAllForUserAsync(string userId, string? ipAddress, CancellationToken cancellationToken = default) =>
        RevokeActiveAsync(
            refreshToken => refreshToken.UserId == userId,
            ipAddress,
            cancellationToken);

    /// <summary>Ends one sign-in, leaving the account's other devices signed in.</summary>
    private Task RevokeSessionAsync(Guid sessionId, string? ipAddress, CancellationToken cancellationToken) =>
        RevokeActiveAsync(
            refreshToken => refreshToken.SessionId == sessionId,
            ipAddress,
            cancellationToken);

    private async Task RevokeActiveAsync(
        System.Linq.Expressions.Expression<Func<RefreshToken, bool>> scope,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var activeTokens = await _dbContext.RefreshTokens
            .Where(scope)
            .Where(refreshToken => refreshToken.RevokedAt == null)
            .ToListAsync(cancellationToken);

        foreach (var token in activeTokens)
        {
            token.RevokedAt = now;
            token.RevokedByIp = ipAddress;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static string GenerateRawToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    private static string Hash(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawToken)));
}
