using System.Security.Cryptography;
using System.Text;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace DineFlow.Tests;

public class RefreshTokenServiceTests
{
    private static (AppDbContext DbContext, RefreshTokenService Service) CreateService(string userId = "user-1")
    {
        var dbContext = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

        dbContext.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = $"{userId}@test.local",
            NormalizedUserName = $"{userId.ToUpperInvariant()}@TEST.LOCAL",
            Email = $"{userId}@test.local",
        });
        dbContext.SaveChanges();

        var options = Options.Create(new JwtOptions { RefreshTokenExpirationDays = 90 });
        return (dbContext, new RefreshTokenService(dbContext, options));
    }

    private static string HashOf(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

    [Fact]
    public async Task IssueAsync_PersistsOnlyTheHash_NeverTheRawToken()
    {
        var (dbContext, service) = CreateService();

        var rawToken = await service.IssueAsync("user-1", "127.0.0.1");

        var stored = Assert.Single(dbContext.RefreshTokens);
        Assert.Equal("user-1", stored.UserId);
        Assert.Equal(HashOf(rawToken), stored.TokenHash);
        Assert.NotEqual(rawToken, stored.TokenHash);
        Assert.Null(stored.RevokedAt);
        Assert.True(stored.ExpiresAt > DateTime.UtcNow.AddDays(89));
    }

    [Fact]
    public async Task RotateAsync_ValidToken_IssuesNewTokenAndRevokesOld()
    {
        var (dbContext, service) = CreateService();
        var original = await service.IssueAsync("user-1", "127.0.0.1");

        var result = await service.RotateAsync(original, "127.0.0.1");

        Assert.True(result.Succeeded);
        Assert.Equal("user-1", result.UserId);
        Assert.NotNull(result.NewRawToken);
        Assert.NotEqual(original, result.NewRawToken);

        var originalRow = await dbContext.RefreshTokens.SingleAsync(t => t.TokenHash == HashOf(original));
        Assert.NotNull(originalRow.RevokedAt);
        Assert.Equal(HashOf(result.NewRawToken!), originalRow.ReplacedByTokenHash);

        var newRow = await dbContext.RefreshTokens.SingleAsync(t => t.TokenHash == HashOf(result.NewRawToken!));
        Assert.Null(newRow.RevokedAt);
    }

    [Fact]
    public async Task RotateAsync_UnknownToken_FailsWithNotFound()
    {
        var (_, service) = CreateService();

        var result = await service.RotateAsync("this-token-was-never-issued", "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.NotFound, result.FailureReason);
    }

    [Fact]
    public async Task RotateAsync_ExpiredToken_FailsWithExpired_AndIsNotRevoked()
    {
        var (dbContext, service) = CreateService();
        var rawToken = await service.IssueAsync("user-1", "127.0.0.1");
        var row = await dbContext.RefreshTokens.SingleAsync();
        row.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await dbContext.SaveChangesAsync();

        var result = await service.RotateAsync(rawToken, "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Expired, result.FailureReason);
        var reloaded = await dbContext.RefreshTokens.SingleAsync();
        Assert.Null(reloaded.RevokedAt); // A plain expiry is not an attack; don't nuke the family for it.
    }

    [Fact]
    public async Task RotateAsync_ReplayOfAnAlreadyRotatedToken_RevokesTheWholeFamily()
    {
        var (dbContext, service) = CreateService();
        var t1 = await service.IssueAsync("user-1", "127.0.0.1");
        var rotateResult = await service.RotateAsync(t1, "127.0.0.1"); // t1 -> t2
        var t2 = rotateResult.NewRawToken!;

        // Someone replays t1 after it was already rotated into t2 — treat as theft.
        var replayResult = await service.RotateAsync(t1, "10.0.0.99");

        Assert.False(replayResult.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Reused, replayResult.FailureReason);

        var t2Row = await dbContext.RefreshTokens.SingleAsync(t => t.TokenHash == HashOf(t2));
        Assert.NotNull(t2Row.RevokedAt); // t2 was still active/legitimate but gets burned too.
    }

    [Fact]
    public async Task RotateAsync_AfterExplicitLogoutRevoke_FailsWithRevoked_NotReused_AndDoesNotNukeOtherSessions()
    {
        var (dbContext, service) = CreateService();
        var loggedOutToken = await service.IssueAsync("user-1", "127.0.0.1");
        var otherActiveToken = await service.IssueAsync("user-1", "127.0.0.1"); // e.g. a second device
        await service.RevokeAsync(loggedOutToken, "127.0.0.1"); // plain logout, never rotated

        var result = await service.RotateAsync(loggedOutToken, "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Revoked, result.FailureReason); // not "Reused"
        var otherRow = await dbContext.RefreshTokens.SingleAsync(t => t.TokenHash == HashOf(otherActiveToken));
        Assert.Null(otherRow.RevokedAt); // logout is benign — no reason to burn other sessions
    }

    [Fact]
    public async Task RevokeAsync_MarksTokenRevoked_AndIsIdempotent()
    {
        var (dbContext, service) = CreateService();
        var rawToken = await service.IssueAsync("user-1", "127.0.0.1");

        await service.RevokeAsync(rawToken, "127.0.0.1");
        var row = await dbContext.RefreshTokens.SingleAsync();
        Assert.NotNull(row.RevokedAt);
        var firstRevokedAt = row.RevokedAt;

        await service.RevokeAsync(rawToken, "127.0.0.1"); // second call must not throw or overwrite
        await dbContext.Entry(row).ReloadAsync();
        Assert.Equal(firstRevokedAt, row.RevokedAt);
    }

    [Fact]
    public async Task RevokeAsync_UnknownToken_IsANoOp()
    {
        var (_, service) = CreateService();

        await service.RevokeAsync("never-issued", "127.0.0.1");

        // No exception is the assertion; nothing else to check.
    }
}
