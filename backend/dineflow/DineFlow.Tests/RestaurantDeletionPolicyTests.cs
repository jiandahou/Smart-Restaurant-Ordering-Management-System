using DineFlow.Api.Services;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Printing;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.EntityFrameworkCore;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using RestaurantTableEntity = DineFlow.Infrastructure.Restaurant.RestaurantTable;

namespace DineFlow.Tests;

/// <summary>
/// Covers the two ways a restaurant delete used to go wrong: an unhandled foreign key violation
/// surfacing as a 500, and a successful delete leaving tables behind pointing at a restaurant that
/// no longer exists.
/// </summary>
public sealed class RestaurantDeletionPolicyTests
{
    private static readonly Guid RestaurantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherRestaurantId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public async Task Blockers_AreEmpty_ForARestaurantWithNoTradingHistory()
    {
        await using var dbContext = CreateDbContext();
        SeedRestaurant(dbContext);
        await dbContext.SaveChangesAsync();

        var blockers = await RestaurantDeletionPolicy.FindBlockersAsync(dbContext, RestaurantId);

        Assert.Empty(blockers);
    }

    [Fact]
    public async Task Blockers_CountEveryRelationshipThatWouldViolateAForeignKey()
    {
        await using var dbContext = CreateDbContext();
        SeedRestaurant(dbContext);
        dbContext.Orders.Add(new Order { Id = Guid.NewGuid(), RestaurantId = RestaurantId, OrderNumber = "ORD-1" });
        dbContext.Orders.Add(new Order { Id = Guid.NewGuid(), RestaurantId = RestaurantId, OrderNumber = "ORD-2" });
        dbContext.Users.Add(new ApplicationUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = "staff@dineflow.test",
            Email = "staff@dineflow.test",
            RestaurantId = RestaurantId,
        });
        dbContext.Carts.Add(new Cart { Id = Guid.NewGuid(), RestaurantId = RestaurantId });
        dbContext.TableSessions.Add(new TableSession { Id = Guid.NewGuid(), RestaurantId = RestaurantId });
        await dbContext.SaveChangesAsync();

        var blockers = await RestaurantDeletionPolicy.FindBlockersAsync(dbContext, RestaurantId);

        Assert.Equal(2, blockers["orders"]);
        Assert.Equal(1, blockers["staff"]);
        Assert.Equal(1, blockers["carts"]);
        Assert.Equal(1, blockers["tableSessions"]);
    }

    [Fact]
    public async Task Blockers_IgnoreOtherRestaurants()
    {
        await using var dbContext = CreateDbContext();
        SeedRestaurant(dbContext);
        dbContext.Orders.Add(new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = OtherRestaurantId,
            OrderNumber = "ORD-OTHER",
        });
        await dbContext.SaveChangesAsync();

        var blockers = await RestaurantDeletionPolicy.FindBlockersAsync(dbContext, RestaurantId);

        Assert.Empty(blockers);
    }

    [Theory]
    [InlineData(1, 0, 0, 0, "1 order")]
    [InlineData(46, 0, 0, 0, "46 orders")]
    [InlineData(46, 3, 0, 0, "46 orders and 3 staff accounts")]
    [InlineData(46, 3, 2, 1, "46 orders, 3 staff accounts, 2 open carts and 1 table session")]
    public void DescribeBlockers_ReadsAsASentence(
        int orders,
        int staff,
        int carts,
        int tableSessions,
        string expected)
    {
        var blockers = new Dictionary<string, int>
        {
            ["orders"] = orders,
            ["staff"] = staff,
            ["carts"] = carts,
            ["tableSessions"] = tableSessions,
        }.Where(entry => entry.Value > 0).ToDictionary(entry => entry.Key, entry => entry.Value);

        Assert.Equal(expected, RestaurantDeletionPolicy.DescribeBlockers(blockers));
    }

    [Fact]
    public async Task RemoveOwnedRecords_ClearsTheRowsThatHaveNoForeignKeyToTheRestaurant()
    {
        await using var dbContext = CreateDbContext();
        SeedRestaurant(dbContext);
        var stationId = Guid.NewGuid();
        dbContext.RestaurantTables.Add(new RestaurantTableEntity
        {
            Id = Guid.NewGuid(),
            RestaurantId = RestaurantId,
            TableNumber = "T1",
        });
        dbContext.RestaurantTables.Add(new RestaurantTableEntity
        {
            Id = Guid.NewGuid(),
            RestaurantId = RestaurantId,
            TableNumber = "T2",
        });
        dbContext.PrintStations.Add(new PrintStation
        {
            Id = stationId,
            RestaurantId = RestaurantId,
            StationKey = "counter",
            Name = "Counter",
        });
        dbContext.PrintJobs.Add(new PrintJob
        {
            Id = Guid.NewGuid(),
            RestaurantId = RestaurantId,
            StationId = stationId,
        });
        dbContext.RestaurantPickupCounters.Add(new RestaurantPickupCounter
        {
            RestaurantId = RestaurantId,
            PickupDate = new DateOnly(2026, 8, 11),
            LastNumber = 12,
        });
        await dbContext.SaveChangesAsync();

        await RestaurantDeletionPolicy.RemoveOwnedRecordsAsync(dbContext, RestaurantId);
        dbContext.Restaurants.Remove(
            await dbContext.Restaurants.SingleAsync(restaurant => restaurant.Id == RestaurantId));
        await dbContext.SaveChangesAsync();

        Assert.Empty(await dbContext.RestaurantTables.ToListAsync());
        Assert.Empty(await dbContext.PrintStations.ToListAsync());
        Assert.Empty(await dbContext.PrintJobs.ToListAsync());
        Assert.Empty(await dbContext.RestaurantPickupCounters.ToListAsync());
        Assert.Empty(await dbContext.Restaurants.ToListAsync());
    }

    [Fact]
    public async Task RemoveOwnedRecords_LeavesAnotherRestaurantsRowsAlone()
    {
        await using var dbContext = CreateDbContext();
        SeedRestaurant(dbContext);
        dbContext.RestaurantTables.Add(new RestaurantTableEntity
        {
            Id = Guid.NewGuid(),
            RestaurantId = RestaurantId,
            TableNumber = "T1",
        });
        dbContext.RestaurantTables.Add(new RestaurantTableEntity
        {
            Id = Guid.NewGuid(),
            RestaurantId = OtherRestaurantId,
            TableNumber = "T1",
        });
        await dbContext.SaveChangesAsync();

        await RestaurantDeletionPolicy.RemoveOwnedRecordsAsync(dbContext, RestaurantId);
        await dbContext.SaveChangesAsync();

        var survivor = Assert.Single(await dbContext.RestaurantTables.ToListAsync());
        Assert.Equal(OtherRestaurantId, survivor.RestaurantId);
    }

    private static void SeedRestaurant(AppDbContext dbContext) =>
        dbContext.Restaurants.Add(new RestaurantEntity
        {
            Id = RestaurantId,
            Name = "Deletion Test Kitchen",
            Timezone = "Australia/Adelaide",
        });

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"restaurant-deletion-{Guid.NewGuid():N}")
            .Options;
        return new AppDbContext(options);
    }
}
