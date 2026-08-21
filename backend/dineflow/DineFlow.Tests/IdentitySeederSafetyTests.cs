using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The seeder decides what a live database gets on every boot, so the boundaries between
/// "always safe", "bootstrap once" and "development only" are asserted rather than assumed.
/// </summary>
public sealed class IdentitySeederSafetyTests
{
    private const string OwnerEmail = "owner@dineflow.test";
    private const string ConfiguredPassword = "Configured123!";

    [Fact]
    public async Task SeedDemoDataAsync_InProduction_Throws()
    {
        await using var services = BuildServices(Environments.Production);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => IdentitySeeder.SeedDemoDataAsync(services));

        Assert.Contains("not permitted in Production", exception.Message, StringComparison.Ordinal);

        // Nothing was written on the way to the guard.
        using var scope = services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Empty(await dbContext.Restaurants.ToListAsync());
        Assert.Empty(await dbContext.Users.ToListAsync());
    }

    [Fact]
    public async Task SeedRolesAsync_InProduction_CreatesEveryRoleAndIsRepeatable()
    {
        await using var services = BuildServices(Environments.Production);

        await IdentitySeeder.SeedRolesAsync(services);
        await IdentitySeeder.SeedRolesAsync(services);

        using var scope = services.CreateScope();
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var roles = await roleManager.Roles.Select(role => role.Name).ToListAsync();

        Assert.Equal(ApplicationRoles.All.Count, roles.Count);
        foreach (var role in ApplicationRoles.All)
        {
            Assert.Contains(role, roles);
        }
    }

    [Fact]
    public async Task SeedPlatformOwnerAsync_InProduction_CreatesTheOwnerWhenMissing()
    {
        await using var services = BuildServices(Environments.Production);
        await IdentitySeeder.SeedRolesAsync(services);

        await IdentitySeeder.SeedPlatformOwnerAsync(services);

        using var scope = services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var owner = await userManager.FindByEmailAsync(OwnerEmail);

        Assert.NotNull(owner);
        Assert.True(await userManager.CheckPasswordAsync(owner!, ConfiguredPassword));
        Assert.Contains(ApplicationRoles.PlatformOwner, await userManager.GetRolesAsync(owner!));
    }

    [Fact]
    public async Task SeedPlatformOwnerAsync_InProduction_LeavesAnExistingOwnersPasswordAlone()
    {
        await using var services = BuildServices(Environments.Production);
        await IdentitySeeder.SeedRolesAsync(services);
        await CreateOwnerWithPasswordAsync(services, "ChosenByTheOwner456!");

        await IdentitySeeder.SeedPlatformOwnerAsync(services);

        using var scope = services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var owner = await userManager.FindByEmailAsync(OwnerEmail);

        Assert.True(await userManager.CheckPasswordAsync(owner!, "ChosenByTheOwner456!"));
        Assert.False(await userManager.CheckPasswordAsync(owner!, ConfiguredPassword));
    }

    [Fact]
    public async Task SeedPlatformOwnerAsync_OutsideProduction_StillResetsThePasswordForConvenience()
    {
        await using var services = BuildServices(Environments.Development);
        await IdentitySeeder.SeedRolesAsync(services);
        await CreateOwnerWithPasswordAsync(services, "ChosenByTheOwner456!");

        await IdentitySeeder.SeedPlatformOwnerAsync(services);

        using var scope = services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var owner = await userManager.FindByEmailAsync(OwnerEmail);

        Assert.True(await userManager.CheckPasswordAsync(owner!, ConfiguredPassword));
    }

    [Fact]
    public async Task SeedPlatformOwnerAsync_WithoutConfiguredCredentials_CreatesNobody()
    {
        await using var services = BuildServices(Environments.Production, configureOwner: false);
        await IdentitySeeder.SeedRolesAsync(services);

        await IdentitySeeder.SeedPlatformOwnerAsync(services);

        using var scope = services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Empty(await dbContext.Users.ToListAsync());
    }

    private static async Task CreateOwnerWithPasswordAsync(IServiceProvider services, string password)
    {
        using var scope = services.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var result = await userManager.CreateAsync(
            new ApplicationUser
            {
                UserName = OwnerEmail,
                Email = OwnerEmail,
                FullName = "DineFlow Owner",
                EmailConfirmed = true,
                CreatedAt = DateTime.UtcNow
            },
            password);

        Assert.True(result.Succeeded);
    }

    private static ServiceProvider BuildServices(string environmentName, bool configureOwner = true)
    {
        var databaseName = $"identity-seeder-{Guid.NewGuid():N}";
        var settings = new Dictionary<string, string?>();

        if (configureOwner)
        {
            settings["SeedOwner:Email"] = OwnerEmail;
            settings["SeedOwner:Password"] = ConfiguredPassword;
            settings["SeedOwner:FullName"] = "DineFlow Owner";
        }

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(
            new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        services.AddSingleton<IHostEnvironment>(new TestHostEnvironment(environmentName));
        services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(databaseName));
        services.AddIdentityCore<ApplicationUser>()
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<AppDbContext>();

        return services.BuildServiceProvider();
    }

    private sealed class TestHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;

        public string ApplicationName { get; set; } = "DineFlow.Tests";

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } =
            new Microsoft.Extensions.FileProviders.NullFileProvider();
    }
}
