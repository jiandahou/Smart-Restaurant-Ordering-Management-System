using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using DineFlow.Infrastructure.Time;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// One table's bill must not outlive the people who sat at it.
/// </summary>
/// <remarks>
/// <para>
/// Against a real database, because what is being checked is which rows a scan finds and what a
/// sweep leaves behind — both of them queries, and both of them wrong in ways an in-memory provider
/// would not reproduce.
/// </para>
/// <para>
/// The reported fault: a session opened on 12 August was still open on 10 September with two
/// strangers' orders on it, and a new diner scanning that table joined it. Their single plate
/// appeared as one more line on a $280 bill.
/// </para>
/// </remarks>
public sealed class TableSessionRolloverTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private const string Timezone = "Australia/Adelaide";
    private Guid _restaurantId;
    private Guid _tableId;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();

        var restaurant = new RestaurantEntity
        {
            Id = Guid.NewGuid(),
            Name = "Rollover Kitchen",
            Currency = "aud",
            Timezone = Timezone,
            IsActive = true,
        };
        var table = new RestaurantTable
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            TableNumber = "T9",
            QrToken = Guid.NewGuid().ToString("N"),
            Capacity = 4,
            IsActive = true,
        };

        context.Restaurants.Add(restaurant);
        context.RestaurantTables.Add(table);
        await context.SaveChangesAsync();

        _restaurantId = restaurant.Id;
        _tableId = table.Id;
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    private static DateTime LocalAsUtc(int year, int month, int day, int hour, int minute) =>
        RestaurantClock.ToUtc(new DateTime(year, month, day, hour, minute, 0), Timezone);

    private async Task<Guid> OpenSessionAsync(DateTime openedAtUtc, params OrderStatus[] orderStatuses)
    {
        await using var context = _database.CreateContext();
        var session = new TableSession
        {
            Id = Guid.NewGuid(),
            RestaurantId = _restaurantId,
            TableId = _tableId,
            Status = TableSessionStatus.Open,
            OpenedAt = openedAtUtc,
            CreatedAt = openedAtUtc,
        };
        context.TableSessions.Add(session);

        var index = 0;
        foreach (var status in orderStatuses)
        {
            context.Orders.Add(new Order
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                TableId = _tableId,
                TableSessionId = session.Id,
                OrderNumber = $"ROLL-{session.Id:N}-{index++}",
                OrderType = OrderType.DineIn,
                Status = status,
                PaymentStatus = PaymentStatus.Unpaid,
                PaymentMethod = PaymentMethod.PayAtCounter,
                TotalAmount = 10m,
                CreatedAt = openedAtUtc,
            });
        }

        await context.SaveChangesAsync();
        return session.Id;
    }

    private async Task<TableSession> ReadAsync(Guid sessionId)
    {
        await using var context = _database.CreateContext();
        return await context.TableSessions.AsNoTracking().SingleAsync(item => item.Id == sessionId);
    }

    private async Task<Guid> ScanAsync(DateTime utcNow)
    {
        await using var context = _database.CreateContext();
        var session = await new TableSessionService(context)
            .GetOrCreateOpenSessionAsync(_restaurantId, _tableId, utcNow, CancellationToken.None);
        await context.SaveChangesAsync();
        return session.Id;
    }

    /// <summary>The reported fault, at its smallest.</summary>
    [RequiresPostgresFact]
    public async Task ADinerTonightDoesNotJoinLastMonthsBill()
    {
        var lastMonth = await OpenSessionAsync(LocalAsUtc(2026, 8, 12, 19, 0), OrderStatus.Completed);

        var tonight = await ScanAsync(LocalAsUtc(2026, 9, 10, 19, 0));

        Assert.NotEqual(lastMonth, tonight);
        Assert.Equal(TableSessionStatus.Closed, (await ReadAsync(lastMonth)).Status);
    }

    /// <summary>
    /// The reason the boundary is a closing hour and not midnight: a late table is one dinner.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ALateTableKeepsOneBillAcrossMidnight()
    {
        var seated = await OpenSessionAsync(LocalAsUtc(2026, 9, 9, 23, 30), OrderStatus.Preparing);

        Assert.Equal(seated, await ScanAsync(LocalAsUtc(2026, 9, 10, 0, 40)));
        Assert.Equal(seated, await ScanAsync(LocalAsUtc(2026, 9, 10, 3, 55)));
    }

    /// <summary>Lunch and dinner on one day are one service day, so the same session serves both.</summary>
    [RequiresPostgresFact]
    public async Task TheSameDaysSittingsShareASession()
    {
        var lunch = await OpenSessionAsync(LocalAsUtc(2026, 9, 10, 12, 30), OrderStatus.Ready);

        Assert.Equal(lunch, await ScanAsync(LocalAsUtc(2026, 9, 10, 19, 30)));
    }

    /// <summary>
    /// The deliberate exception. A stale session still holding live orders is a table with
    /// something unresolved on it, and the counter reads a table's live orders from its open
    /// session: closing it would take those orders off every screen that could deal with them.
    /// Hiding them is a worse failure than the one being fixed, so a person has to.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AnUnresolvedOrderKeepsItsSessionRatherThanDisappearing()
    {
        var stale = await OpenSessionAsync(LocalAsUtc(2026, 8, 12, 19, 0), OrderStatus.Accepted);

        Assert.Equal(stale, await ScanAsync(LocalAsUtc(2026, 9, 10, 19, 0)));
        Assert.Equal(TableSessionStatus.Open, (await ReadAsync(stale)).Status);
    }

    /// <summary>A table nobody has sat at yet gets a session of its own.</summary>
    [RequiresPostgresFact]
    public async Task AnEmptyTableOpensAFreshSession()
    {
        var first = await ScanAsync(LocalAsUtc(2026, 9, 10, 19, 0));

        Assert.Equal(first, await ScanAsync(LocalAsUtc(2026, 9, 10, 19, 5)));
    }

    // ---- the sweep ----------------------------------------------------------------------------

    private async Task<int> SweepAsync()
    {
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseNpgsql(_database.ConnectionString));

        return await new FinishedTableSessionSweep(
                services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
                NullLogger<FinishedTableSessionSweep>.Instance)
            .CloseBatchAsync(CancellationToken.None);
    }

    /// <summary>
    /// The other half. A session whose last order was cancelled, rejected or timed out stayed open
    /// for ever, because only the counter ever closed one — which is how an empty dining room came
    /// to report six occupied tables.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ASessionWhoseOrdersAllEndedIsClosed()
    {
        var expired = await OpenSessionAsync(
            LocalAsUtc(2026, 9, 10, 12, 0),
            OrderStatus.Cancelled,
            OrderStatus.Rejected);

        Assert.Equal(1, await SweepAsync());
        Assert.Equal(TableSessionStatus.Closed, (await ReadAsync(expired)).Status);
    }

    [RequiresPostgresFact]
    public async Task ASessionStillCookingIsLeftAlone()
    {
        var live = await OpenSessionAsync(
            LocalAsUtc(2026, 9, 10, 12, 0),
            OrderStatus.Completed,
            OrderStatus.Preparing);

        Assert.Equal(0, await SweepAsync());
        Assert.Equal(TableSessionStatus.Open, (await ReadAsync(live)).Status);
    }

    /// <summary>
    /// Someone who has scanned the code and is still reading the menu has no orders yet either.
    /// Closing that session would take the cart out from under them.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ATableThatHasOnlyJustBeenScannedIsLeftAlone()
    {
        var justScanned = await OpenSessionAsync(LocalAsUtc(2026, 9, 10, 19, 0));

        Assert.Equal(0, await SweepAsync());
        Assert.Equal(TableSessionStatus.Open, (await ReadAsync(justScanned)).Status);
    }
}
