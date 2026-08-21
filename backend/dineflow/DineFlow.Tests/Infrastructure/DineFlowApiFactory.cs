using System.Net.Http.Headers;
using System.Net.Http.Json;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Stripe;
using Npgsql;
using Xunit;

namespace DineFlow.Tests.Infrastructure;

/// <summary>
/// The real API, hosted in-process against a throwaway PostgreSQL database.
/// </summary>
/// <remarks>
/// <para>
/// The suite tested policies and one concurrency case; nothing exercised an endpoint. Everything
/// between the route and the policy — who is allowed to call it, whether one restaurant's staff can
/// reach another's money, what a missing field does, whether a validation failure is a 400 or a
/// 500 — was covered by nothing at all, and those are the parts an attacker and a tired cashier both
/// meet first.
/// </para>
/// <para>
/// Calling controller methods directly would not answer any of it: authorization filters, model
/// binding and validation all live in the pipeline, not in the method. So the API runs for real, and
/// tests talk to it over HTTP.
/// </para>
/// </remarks>
public sealed class DineFlowApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _databaseName = $"dineflow_api_{Guid.NewGuid():N}";
    private string? _adminConnectionString;

    /// <summary>Null when no test database is configured, which is the signal to skip.</summary>
    public string? ConnectionString { get; private set; }

    public const string OwnerEmail = "api-test-owner@dineflow.test";
    public const string OwnerPassword = "ApiTest123!$";

    /// <summary>Lets a test sign a webhook the way Stripe does, so the endpoint's own verification runs.</summary>
    public const string StripeWebhookSecret = "whsec_dineflow_integration_test";

    public async Task InitializeAsync()
    {
        _adminConnectionString = PostgresTestDatabase.AdminConnectionStringOrNull;
        if (string.IsNullOrWhiteSpace(_adminConnectionString))
        {
            return;
        }

        await using (var admin = new NpgsqlConnection(_adminConnectionString))
        {
            await admin.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{_databaseName}\"", admin);
            await create.ExecuteNonQueryAsync();
        }

        ConnectionString = new NpgsqlConnectionStringBuilder(_adminConnectionString)
        {
            Database = _databaseName
        }.ConnectionString;

        // Touching Services boots the host, which migrates and seeds roles against the new database.
        _ = Services;
    }

    /// <summary>Set before the host boots to answer for Stripe instead of the real thing.</summary>
    public StubStripeClient? Stripe { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            if (Stripe is not null)
            {
                services.RemoveAll<IStripeClient>();
                services.AddSingleton<IStripeClient>(Stripe);
            }
        });
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureHostConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:DefaultConnection"] = ConnectionString,
            // The startup path is the one deployments use, so let it run: it proves the migrations
            // and the role seeding still work together.
            ["Database:MigrateOnStartup"] = "true",
            // Demo restaurants and shared-password accounts would be noise here, and every test that
            // counts anything would have to know about them.
            ["Seed:DemoData"] = "false",
            ["Jwt:Issuer"] = "dineflow-tests",
            ["Jwt:Audience"] = "dineflow-tests",
            // Only ever reaches a throwaway database that is dropped when the test class finishes.
            ["Jwt:SecretKey"] = "dineflow-integration-test-signing-key-not-a-secret",
            ["Jwt:ExpirationMinutes"] = "60",
            ["Stripe:SecretKey"] = "sk_test_dineflow_integration",
            ["Stripe:WebhookSecret"] = StripeWebhookSecret,
            ["SeedOwner:Email"] = OwnerEmail,
            ["SeedOwner:Password"] = OwnerPassword,
            ["SeedOwner:FullName"] = "API Test Owner",
        }));

        return base.CreateHost(builder);
    }

    /// <summary>A scope on the API's own services, for arranging data the way the API would see it.</summary>
    public IServiceScope CreateScope() => Services.CreateScope();

    public async Task UseDbAsync(Func<AppDbContext, Task> work)
    {
        using var scope = CreateScope();
        await work(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    /// <summary>
    /// Creates a user and returns a client that talks to the API as them.
    /// </summary>
    /// <remarks>
    /// Signed in through the real login endpoint rather than by minting a token here: a test that
    /// forges its own credentials cannot tell you whether the API's own authentication still works.
    /// </remarks>
    public async Task<HttpClient> SignInAsAsync(string email, string role, Guid? restaurantId = null)
    {
        using (var scope = CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var existing = await users.FindByEmailAsync(email);

            if (existing is null)
            {
                var user = new ApplicationUser
                {
                    UserName = email,
                    Email = email,
                    EmailConfirmed = true,
                    FullName = email,
                    RestaurantId = restaurantId
                };

                var created = await users.CreateAsync(user, OwnerPassword);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(error => error.Description)));
                Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
            }
        }

        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password = OwnerPassword });
        Assert.True(
            response.IsSuccessStatusCode,
            $"Signing in as {email} failed: {response.StatusCode} {await response.Content.ReadAsStringAsync()}");

        var payload = await response.Content.ReadFromJsonAsync<LoginPayload>();
        Assert.False(string.IsNullOrWhiteSpace(payload?.Token), "Login returned no token.");

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", payload!.Token);
        return client;
    }

    private sealed record LoginPayload(string? Token);

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();

        if (string.IsNullOrWhiteSpace(_adminConnectionString) || ConnectionString is null)
        {
            return;
        }

        NpgsqlConnection.ClearAllPools();

        await using var admin = new NpgsqlConnection(_adminConnectionString);
        await admin.OpenAsync();
        await using var drop = new NpgsqlCommand(
            $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)",
            admin);
        await drop.ExecuteNonQueryAsync();
    }
}
