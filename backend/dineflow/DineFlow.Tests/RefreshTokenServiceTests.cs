using System.Security.Cryptography;
using System.Text;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Rotation claims its token with a conditional update, so the tests that rotate need a database
/// that can run one. That is not a testing inconvenience but the point: an in-memory provider has no
/// atomicity to assert against, and these tests passed for as long as the bug existed — one refresh
/// token could be rotated into six by presenting it from six tabs at once.
/// </summary>
public class RefreshTokenServiceTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();

    public Task InitializeAsync() => _database.InitializeAsync();

    public Task DisposeAsync() => _database.DisposeAsync();

    private (AppDbContext DbContext, RefreshTokenService Service, string UserId) CreateService(string? userId = null)
    {
        // A shared database across the class, so each test brings its own account.
        userId ??= $"user-{Guid.NewGuid():N}";

        var dbContext = _database.ConnectionString is null
            ? new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options)
            : _database.CreateContext();

        dbContext.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = $"{userId}@test.local",
            NormalizedUserName = $"{userId.ToUpperInvariant()}@TEST.LOCAL",
            Email = $"{userId}@test.local",
        });
        dbContext.SaveChanges();

        var options = Options.Create(new JwtOptions { RefreshTokenExpirationDays = 90 });
        return (dbContext, new RefreshTokenService(dbContext, options), userId);
    }

    private static string HashOf(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

    [Fact]
    public async Task IssueAsync_PersistsOnlyTheHash_NeverTheRawToken()
    {
        var (dbContext, service, userId) = CreateService();

        var rawToken = await service.IssueAsync(userId, "127.0.0.1");

        var stored = Assert.Single(dbContext.RefreshTokens.AsNoTracking().Where(t => t.UserId == userId).ToList());
        Assert.Equal(userId, stored.UserId);
        Assert.Equal(HashOf(rawToken), stored.TokenHash);
        Assert.NotEqual(rawToken, stored.TokenHash);
        Assert.Null(stored.RevokedAt);
        Assert.True(stored.ExpiresAt > DateTime.UtcNow.AddDays(89));
    }

    [RequiresPostgresFact]
    public async Task RotateAsync_ValidToken_IssuesNewTokenAndRevokesOld()
    {
        var (dbContext, service, userId) = CreateService();
        var original = await service.IssueAsync(userId, "127.0.0.1");

        var result = await service.RotateAsync(original, "127.0.0.1");

        Assert.True(result.Succeeded);
        Assert.Equal(userId, result.UserId);
        Assert.NotNull(result.NewRawToken);
        Assert.NotEqual(original, result.NewRawToken);

        var originalRow = await dbContext.RefreshTokens.AsNoTracking().SingleAsync(t => t.TokenHash == HashOf(original));
        Assert.NotNull(originalRow.RevokedAt);
        Assert.Equal(HashOf(result.NewRawToken!), originalRow.ReplacedByTokenHash);

        var newRow = await dbContext.RefreshTokens.AsNoTracking().SingleAsync(t => t.TokenHash == HashOf(result.NewRawToken!));
        Assert.Null(newRow.RevokedAt);
    }

    [RequiresPostgresFact]
    public async Task RotateAsync_UnknownToken_FailsWithNotFound()
    {
        var (_, service, userId) = CreateService();

        var result = await service.RotateAsync("this-token-was-never-issued", "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.NotFound, result.FailureReason);
    }

    [RequiresPostgresFact]
    public async Task RotateAsync_ExpiredToken_FailsWithExpired_AndIsNotRevoked()
    {
        var (dbContext, service, userId) = CreateService();
        var rawToken = await service.IssueAsync(userId, "127.0.0.1");
        var row = await dbContext.RefreshTokens.SingleAsync(t => t.UserId == userId);
        row.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
        await dbContext.SaveChangesAsync();

        var result = await service.RotateAsync(rawToken, "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Expired, result.FailureReason);
        var reloaded = await dbContext.RefreshTokens.AsNoTracking().SingleAsync(t => t.UserId == userId);
        Assert.Null(reloaded.RevokedAt); // A plain expiry is not an attack; don't nuke the family for it.
    }

    [RequiresPostgresFact]
    public async Task RotateAsync_ReplayOfAnAlreadyRotatedToken_RevokesTheWholeFamily()
    {
        var (dbContext, service, userId) = CreateService();
        var t1 = await service.IssueAsync(userId, "127.0.0.1");
        var rotateResult = await service.RotateAsync(t1, "127.0.0.1"); // t1 -> t2
        var t2 = rotateResult.NewRawToken!;

        // Aged past the rotation grace window, because within it a replay is the token's own owner
        // racing itself — two tabs sharing one stored token — and burning the family for that signs
        // a restaurant's till out mid-service. A thief has to obtain the token before replaying it,
        // so theft lands outside the window, which is what this test is about.
        var rotatedRow = await dbContext.RefreshTokens.SingleAsync(t => t.TokenHash == HashOf(t1));
        rotatedRow.RevokedAt = DateTime.UtcNow
            .Subtract(RefreshTokenRotationRace.GracePeriod)
            .AddMinutes(-1);
        await dbContext.SaveChangesAsync();

        // Someone replays t1 after it was already rotated into t2 — treat as theft.
        var replayResult = await service.RotateAsync(t1, "10.0.0.99");

        Assert.False(replayResult.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Reused, replayResult.FailureReason);

        var t2Row = await dbContext.RefreshTokens.AsNoTracking().SingleAsync(t => t.TokenHash == HashOf(t2));
        Assert.NotNull(t2Row.RevokedAt); // t2 was still active/legitimate but gets burned too.
    }

    [RequiresPostgresFact]
    public async Task RotateAsync_AfterExplicitLogoutRevoke_FailsWithRevoked_NotReused_AndDoesNotNukeOtherSessions()
    {
        var (dbContext, service, userId) = CreateService();
        var loggedOutToken = await service.IssueAsync(userId, "127.0.0.1");
        var otherActiveToken = await service.IssueAsync(userId, "127.0.0.1"); // e.g. a second device
        await service.RevokeAsync(loggedOutToken, "127.0.0.1"); // plain logout, never rotated

        var result = await service.RotateAsync(loggedOutToken, "127.0.0.1");

        Assert.False(result.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.Revoked, result.FailureReason); // not "Reused"
        var otherRow = await dbContext.RefreshTokens.AsNoTracking().SingleAsync(t => t.TokenHash == HashOf(otherActiveToken));
        Assert.Null(otherRow.RevokedAt); // logout is benign — no reason to burn other sessions
    }

    [Fact]
    public async Task RevokeAsync_MarksTokenRevoked_AndIsIdempotent()
    {
        var (dbContext, service, userId) = CreateService();
        var rawToken = await service.IssueAsync(userId, "127.0.0.1");

        await service.RevokeAsync(rawToken, "127.0.0.1");

        // Read back from storage both times. Comparing a value assigned in memory against one that
        // has been through the database compares two different precisions, not two decisions.
        async Task<DateTime?> StoredRevokedAt() => (await dbContext.RefreshTokens
            .AsNoTracking()
            .SingleAsync(t => t.UserId == userId)).RevokedAt;

        var firstRevokedAt = await StoredRevokedAt();
        Assert.NotNull(firstRevokedAt);

        await service.RevokeAsync(rawToken, "127.0.0.1"); // second call must not throw or overwrite

        Assert.Equal(firstRevokedAt, await StoredRevokedAt());
    }

    [Fact]
    public async Task RevokeAsync_UnknownToken_IsANoOp()
    {
        var (_, service, userId) = CreateService();

        await service.RevokeAsync("never-issued", "127.0.0.1");

        // No exception is the assertion; nothing else to check.
    }
}
