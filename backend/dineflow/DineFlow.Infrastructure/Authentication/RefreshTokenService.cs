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

        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = userId,
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
        var existing = await _dbContext.RefreshTokens
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

            // Rotated away and now being presented again — someone is replaying
            // an old token (stolen copy, or a retried request racing a prior
            // refresh). Treat it as compromise and kill every active token for
            // the user so both the legitimate and illegitimate holder are forced
            // to log in again.
            await RevokeAllActiveForUserAsync(existing.UserId, ipAddress, cancellationToken);
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Reused);
        }

        if (existing.ExpiresAt <= DateTime.UtcNow)
        {
            return RefreshTokenRotationResult.Failure(RefreshTokenFailureReason.Expired);
        }

        var newRawToken = GenerateRawToken();
        var newTokenHash = Hash(newRawToken);

        existing.RevokedAt = DateTime.UtcNow;
        existing.RevokedByIp = ipAddress;
        existing.ReplacedByTokenHash = newTokenHash;

        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = existing.UserId,
            TokenHash = newTokenHash,
            ExpiresAt = DateTime.UtcNow.AddDays(_jwtOptions.RefreshTokenExpirationDays),
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

    private async Task RevokeAllActiveForUserAsync(string userId, string? ipAddress, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var activeTokens = await _dbContext.RefreshTokens
            .Where(refreshToken => refreshToken.UserId == userId && refreshToken.RevokedAt == null)
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
