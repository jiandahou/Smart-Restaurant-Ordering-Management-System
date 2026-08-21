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
/// Two tabs of one browser share a single refresh token in local storage. When both wake after the
/// access token expires, both present it: one rotates, and the other was being treated as a stolen
/// copy — which revoked every token the account held, on every device.
///
/// <para>
/// A restaurant feels that as lost orders. The till stops showing new tickets, stops sounding and
/// stops printing; the orders are still in the database, but out of everybody's sight, which is the
/// same thing to the customer waiting for food. It was observed here: thirty-six tokens spanning
/// five days revoked in the same second, right after two refreshes landed together.
/// </para>
/// </summary>
public class RefreshTokenRotationRaceTests
{
    private static readonly DateTime RotatedAt = new(2026, 8, 14, 15, 43, 13, DateTimeKind.Utc);

    [Fact]
    public void AReplayMomentsLaterIsTheOwnerRacingItself()
    {
        Assert.True(RefreshTokenRotationRace.IsRace(RotatedAt, RotatedAt.AddMilliseconds(80)));
    }

    [Fact]
    public void AReplayLongAfterwardsIsStillTreatedAsTheft()
    {
        Assert.False(RefreshTokenRotationRace.IsRace(RotatedAt, RotatedAt.AddMinutes(5)));
    }

    /// <summary>The boundary belongs to the customer, not the attacker: exactly at it still counts.</summary>
    [Fact]
    public void TheEdgeOfTheWindowIsStillARace()
    {
        Assert.True(RefreshTokenRotationRace.IsRace(RotatedAt, RotatedAt.Add(RefreshTokenRotationRace.GracePeriod)));
        Assert.False(RefreshTokenRotationRace.IsRace(
            RotatedAt,
            RotatedAt.Add(RefreshTokenRotationRace.GracePeriod).AddSeconds(1)));
    }

    /// <summary>Clock skew must not turn a replay into a race by appearing to precede it.</summary>
    [Fact]
    public void AReplayThatAppearsToPrecedeTheRotationIsNotARace()
    {
        Assert.False(RefreshTokenRotationRace.IsRace(RotatedAt, RotatedAt.AddSeconds(-1)));
    }

    /// <summary>Tokens are foreign-keyed to an account, so one has to exist to hold them.</summary>
    private static async Task<string> SeedUserAsync(AppDbContext context)
    {
        var userId = $"race-{Guid.NewGuid():N}";
        context.Users.Add(new ApplicationUser
        {
            Id = userId,
            UserName = $"{userId}@test.local",
            NormalizedUserName = $"{userId.ToUpperInvariant()}@TEST.LOCAL",
            Email = $"{userId}@test.local",
        });
        await context.SaveChangesAsync();
        return userId;
    }

    private static RefreshTokenService NewService(AppDbContext context) =>
        new(context, Options.Create(new JwtOptions
        {
            SecretKey = new string('k', 64),
            Issuer = "DineFlow.Api",
            Audience = "DineFlow.Client",
            ExpirationMinutes = 60,
            RefreshTokenExpirationDays = 90,
        }));



    /// <summary>The whole point: the losing tab must not take the account down with it.</summary>
    [RequiresPostgresFact]
    public async Task ASecondTabRacingTheFirstDoesNotSignTheAccountOut()
    {
        await using var database = new PostgresTestDatabase();
        await database.InitializeAsync();
        if (database.ConnectionString is null) return;
        await using var context = database.CreateContext();
        var userId = await SeedUserAsync(context);
        var service = NewService(context);
        var shared = await service.IssueAsync(userId, "127.0.0.1");
        var otherDevice = await service.IssueAsync(userId, "127.0.0.1");

        var winner = await service.RotateAsync(shared, "127.0.0.1");
        var loser = await service.RotateAsync(shared, "127.0.0.1");

        Assert.True(winner.Succeeded);
        Assert.False(loser.Succeeded);
        Assert.Equal(RefreshTokenFailureReason.RotationRace, loser.FailureReason);

        // The till on the other side of the kitchen keeps working.
        Assert.True((await service.RotateAsync(otherDevice, "127.0.0.1")).Succeeded);
    }

    /// <summary>
    /// And the protection it exists for still works: a token replayed after the window takes the
    /// account's other sessions down, which is the correct answer to a stolen copy.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AReplayAfterTheWindowStillRevokesEverything()
    {
        await using var database = new PostgresTestDatabase();
        await database.InitializeAsync();
        if (database.ConnectionString is null) return;
        await using var context = database.CreateContext();
        var userId = await SeedUserAsync(context);
        var service = NewService(context);
        var stolen = await service.IssueAsync(userId, "127.0.0.1");
        var otherDevice = await service.IssueAsync(userId, "127.0.0.1");

        await service.RotateAsync(stolen, "127.0.0.1");

        // Age the rotation past the grace window.
        var rotated = context.RefreshTokens.Single(token => token.ReplacedByTokenHash != null);
        rotated.RevokedAt = DateTime.UtcNow.Subtract(RefreshTokenRotationRace.GracePeriod).AddMinutes(-1);
        await context.SaveChangesAsync();

        var replay = await service.RotateAsync(stolen, "127.0.0.1");

        Assert.Equal(RefreshTokenFailureReason.Reused, replay.FailureReason);
        Assert.False((await service.RotateAsync(otherDevice, "127.0.0.1")).Succeeded);
    }

    /// <summary>An explicit logout is still an explicit logout, and says so.</summary>
    [RequiresPostgresFact]
    public async Task ALoggedOutTokenIsNotMistakenForARace()
    {
        await using var database = new PostgresTestDatabase();
        await database.InitializeAsync();
        if (database.ConnectionString is null) return;
        await using var context = database.CreateContext();
        var userId = await SeedUserAsync(context);
        var service = NewService(context);
        var token = await service.IssueAsync(userId, "127.0.0.1");

        await service.RevokeAsync(token, "127.0.0.1");

        Assert.Equal(RefreshTokenFailureReason.Revoked, (await service.RotateAsync(token, "127.0.0.1")).FailureReason);
    }
}
