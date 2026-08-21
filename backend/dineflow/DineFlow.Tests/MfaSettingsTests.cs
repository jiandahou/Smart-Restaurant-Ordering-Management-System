using System.Security.Claims;
using System.Text.Json;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DineFlow.Tests;

public sealed class MfaSettingsTests
{
    [Fact]
    public async Task GetSettings_WhenNoRowExists_ReturnsDefaultsWithoutWriting()
    {
        await using var context = CreateContext();
        var user = CreateUser();
        var controller = CreateController(context, user);

        var result = await controller.GetSettings(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(ok.Value));

        Assert.False(json.RootElement.GetProperty("enabled").GetBoolean());
        Assert.Empty(json.RootElement.GetProperty("methods").EnumerateArray());
        Assert.Equal(MfaMethods.Totp, json.RootElement.GetProperty("preferredMethod").GetString());
        Assert.Empty(await context.UserMfaSettings.ToListAsync());
    }

    [Fact]
    public async Task UpdateSettings_WhenNoRowExists_CreatesAndUpdatesOneRow()
    {
        await using var context = CreateContext();
        var user = CreateUser();
        var controller = CreateController(context, user);

        var result = await controller.UpdateSettings(new UpdateMfaSettingsRequest
        {
            RequireForLogin = true,
            RequireForSensitiveActions = true
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        var settings = Assert.Single(await context.UserMfaSettings.ToListAsync());
        Assert.Equal(user.Id, settings.UserId);
        Assert.True(settings.RequireForLogin);
        Assert.False(settings.RequireForPayment);
        Assert.True(settings.RequireForSensitiveActions);
    }

    private static AppDbContext CreateContext() => new(
        new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"mfa-settings-{Guid.NewGuid():N}")
            .Options);

    private static ApplicationUser CreateUser() => new()
    {
        Id = "mfa-settings-user",
        Email = "mfa-settings@example.com",
        EmailConfirmed = true
    };

    private static MfaController CreateController(AppDbContext context, ApplicationUser user)
    {
        var userStore = new UserStore<ApplicationUser>(context);
        var userManager = new TestUserManager(userStore, user);
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, user.Id)],
                authenticationType: "Test"))
        };
        var controller = new MfaController(
            context,
            null!,
            null!,
            null!,
            null!,
            null!,
            userManager,
            TestServiceStubs.CreateReportLogWriter(context),
            null!)
        {
            ControllerContext = new ControllerContext { HttpContext = httpContext }
        };

        return controller;
    }

    private sealed class TestUserManager : UserManager<ApplicationUser>
    {
        private readonly ApplicationUser _user;

        public TestUserManager(IUserStore<ApplicationUser> store, ApplicationUser user)
            : base(
                store,
                Microsoft.Extensions.Options.Options.Create(new IdentityOptions()),
                new PasswordHasher<ApplicationUser>(),
                [],
                [],
                new UpperInvariantLookupNormalizer(),
                new IdentityErrorDescriber(),
                null!,
                NullLogger<UserManager<ApplicationUser>>.Instance)
        {
            _user = user;
        }

        public override Task<ApplicationUser?> FindByIdAsync(string userId) =>
            Task.FromResult<ApplicationUser?>(userId == _user.Id ? _user : null);
    }
}
