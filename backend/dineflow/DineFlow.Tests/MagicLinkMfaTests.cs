using System.Text.Json;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Api.Controllers;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace DineFlow.Tests;

public sealed class MagicLinkMfaTests
{
    [Fact]
    public async Task MagicLinkLogin_WithRequiredTotp_ReturnsChallengeWithoutTokens()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"magic-link-mfa-{Guid.NewGuid():N}")
            .Options;
        await using var dbContext = new AppDbContext(options);
        var user = new ApplicationUser
        {
            Id = "magic-link-user",
            Email = "mfa@example.com",
            EmailConfirmed = true
        };

        dbContext.UserMfaSettings.Add(new UserMfaSettings
        {
            UserId = user.Id,
            TotpEnabled = true,
            RequireForLogin = true,
            PreferredMethod = MfaMethods.Totp
        });
        await dbContext.SaveChangesAsync();

        var userStore = new UserStore<ApplicationUser>(dbContext);
        var userManager = new MagicLinkUserManager(userStore, user);
        var challengeStore = new RecordingMfaLoginChallengeStore();
        var controller = new AuthController(
            userManager,
            null!,
            null!,
            null!,
            null!,
            null!,
            null!,
            null!,
            challengeStore,
            dbContext,
            new TransactionalEmailLayout(Options.Create(new ComplianceOptions())),
            null!,
            Options.Create(new EmailOptions()),
            Options.Create(new AvatarStorageOptions()),
            null!,
            null!,
            NullLogger<AuthController>.Instance,
            Infrastructure.TestServiceStubs.CreateReportLogWriter(dbContext));

        var result = await controller.MagicLinkLogin(
            new MagicLinkLoginRequest { UserId = user.Id, Token = "valid-magic-link" },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));
        var payload = json.RootElement;

        Assert.True(payload.GetProperty("mfaRequired").GetBoolean());
        Assert.Equal("test-mfa-challenge", payload.GetProperty("challengeId").GetString());
        Assert.False(payload.TryGetProperty("token", out _));
        Assert.False(payload.TryGetProperty("refreshToken", out _));
        Assert.Equal(user.Id, challengeStore.UserId);
        Assert.Equal([MfaMethods.Totp], challengeStore.Methods);
    }

    private sealed class MagicLinkUserManager : UserManager<ApplicationUser>
    {
        private readonly ApplicationUser _user;

        public MagicLinkUserManager(IUserStore<ApplicationUser> store, ApplicationUser user)
            : base(
                store,
                Microsoft.Extensions.Options.Options.Create(new IdentityOptions()),
                new PasswordHasher<ApplicationUser>(),
                [],
                [],
                new UpperInvariantLookupNormalizer(),
                new IdentityErrorDescriber(),
                new EmptyServiceProvider(),
                NullLogger<UserManager<ApplicationUser>>.Instance)
        {
            _user = user;
        }

        public override Task<ApplicationUser?> FindByIdAsync(string userId) =>
            Task.FromResult<ApplicationUser?>(userId == _user.Id ? _user : null);

        public override Task<bool> IsEmailConfirmedAsync(ApplicationUser user) => Task.FromResult(true);

        public override Task<bool> VerifyUserTokenAsync(
            ApplicationUser user,
            string tokenProvider,
            string purpose,
            string token) => Task.FromResult(token == "valid-magic-link");

        public override Task<IdentityResult> UpdateSecurityStampAsync(ApplicationUser user) =>
            Task.FromResult(IdentityResult.Success);
    }

    private sealed class EmptyServiceProvider : IServiceProvider
    {
        public object? GetService(Type serviceType) => null;
    }

    private sealed class RecordingMfaLoginChallengeStore : IMfaLoginChallengeStore
    {
        public string? UserId { get; private set; }

        public IReadOnlyCollection<string> Methods { get; private set; } = [];

        public string Create(string userId, IReadOnlyCollection<string> methods, string? emailCode)
        {
            UserId = userId;
            Methods = methods;
            return "test-mfa-challenge";
        }

        public bool TryGet(string challengeId, out MfaLoginChallenge challenge)
        {
            challenge = new MfaLoginChallenge(string.Empty, [], null);
            return false;
        }

        public bool TryConsume(string challengeId, out MfaLoginChallenge challenge) =>
            TryGet(challengeId, out challenge);
    }
}
