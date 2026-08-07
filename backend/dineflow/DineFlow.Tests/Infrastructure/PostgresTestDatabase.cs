using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace DineFlow.Tests.Infrastructure;

/// <summary>
/// A throwaway PostgreSQL database for tests that need real locking behaviour, which no in-memory
/// provider can emulate. Opt-in: set DINEFLOW_TEST_DB to an admin connection string, e.g.
/// Host=localhost;Port=5433;Database=postgres;Username=dineflow_user;Password=...
/// </summary>
public sealed class PostgresTestDatabase : IAsyncLifetime
{
    private readonly string _databaseName = $"dineflow_test_{Guid.NewGuid():N}";
    private string? _adminConnectionString;

    public string? ConnectionString { get; private set; }

    public static string? AdminConnectionStringOrNull =>
        Environment.GetEnvironmentVariable("DINEFLOW_TEST_DB");

    public async Task InitializeAsync()
    {
        _adminConnectionString = AdminConnectionStringOrNull;
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

        await using var context = CreateContext();
        await context.Database.MigrateAsync();
    }

    public AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(ConnectionString)
            .Options);

    public async Task DisposeAsync()
    {
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

/// Skips rather than fails when no test database is configured, so the suite stays runnable
/// anywhere while still executing for real when a database is available.
public sealed class RequiresPostgresFactAttribute : FactAttribute
{
    public RequiresPostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(PostgresTestDatabase.AdminConnectionStringOrNull))
        {
            Skip = "Set DINEFLOW_TEST_DB to run PostgreSQL concurrency tests.";
        }
    }
}
