using System.Security.Claims;
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

public sealed class MfaSettingsConcurrencyTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private const string UserId = "concurrent-mfa-settings-user";

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();

        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();
        context.Users.Add(CreateUser());
        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    [RequiresPostgresFact]
    public async Task ConcurrentFirstUpdates_BothSucceedAndCreateOneSettingsRow()
    {
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = UpdateSettingsAsync(gate.Task, requireForLogin: true);
        var second = UpdateSettingsAsync(gate.Task, requireForLogin: false);

        gate.SetResult();
        var results = await Task.WhenAll(first, second);

        Assert.All(results, result => Assert.IsType<OkObjectResult>(result));

        await using var context = _database.CreateContext();
        Assert.Equal(1, await context.UserMfaSettings.CountAsync(settings => settings.UserId == UserId));
    }

    private async Task<IActionResult> UpdateSettingsAsync(Task gate, bool requireForLogin)
    {
        await using var context = _database.CreateContext();
        var controller = CreateController(context, CreateUser());
        await gate;

        return await controller.UpdateSettings(new UpdateMfaSettingsRequest
        {
            RequireForLogin = requireForLogin,
            RequireForSensitiveActions = true
        }, CancellationToken.None);
    }

    private static ApplicationUser CreateUser() => new()
    {
        Id = UserId,
        UserName = "concurrent-mfa@example.com",
        NormalizedUserName = "CONCURRENT-MFA@EXAMPLE.COM",
        Email = "concurrent-mfa@example.com",
        NormalizedEmail = "CONCURRENT-MFA@EXAMPLE.COM",
        EmailConfirmed = true,
        SecurityStamp = Guid.NewGuid().ToString("N")
    };

    private static MfaController CreateController(AppDbContext context, ApplicationUser user)
    {
        var userManager = new TestUserManager(new UserStore<ApplicationUser>(context), user);
        var httpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, user.Id)],
                authenticationType: "Test"))
        };

        return new MfaController(
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
