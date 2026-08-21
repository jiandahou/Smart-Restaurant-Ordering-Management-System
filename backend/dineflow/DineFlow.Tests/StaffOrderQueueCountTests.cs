using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The queue counts, run against a real database.
/// </summary>
/// <remarks>
/// The bug was that the counts described the page rather than the queue, so sorting the same 402
/// orders the other way moved "Active" from 14 to 26. Both halves of the fix — grouping in SQL to
/// count, and a SQL predicate to pick the rows — are second statements of rules written in C#, and
/// neither can be checked without a database that can actually run them.
/// </remarks>
public sealed class StaffOrderQueueCountTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _restaurantId;

    private static readonly DateTime Now = new(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc);

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
            Name = "Queue Count Kitchen",
            Currency = "aud",
            Timezone = "Australia/Sydney",
            IsActive = true
        };
        _restaurantId = restaurant.Id;
        context.Restaurants.Add(restaurant);

        // One order for every shape the rules distinguish, at every age they turn on. Spread across a
        // wide span of creation times so that sorting has something to reorder.
        var number = 0;
        foreach (var status in Enum.GetValues<OrderStatus>())
        {
            foreach (var paymentStatus in Enum.GetValues<PaymentStatus>())
            {
                foreach (var method in new[] { PaymentMethod.Online, PaymentMethod.PayAtCounter })
                {
                    foreach (var age in new[] { TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(45), TimeSpan.FromHours(30) })
                    {
                        number++;
                        context.Orders.Add(new Order
                        {
                            Id = Guid.NewGuid(),
                            RestaurantId = _restaurantId,
                            OrderNumber = $"ORD-QUEUE-{number:D4}",
                            Status = status,
                            PaymentStatus = paymentStatus,
                            PaymentMethod = method,
                            TotalAmount = 10m,
                            CreatedAt = Now - age
                        });
                    }
                }
            }
        }

        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    /// <summary>
    /// A queue holds exactly the orders the rules put in it, and its count says how many that is.
    /// </summary>
    /// <remarks>
    /// Compared order by order rather than by totals. Two mistakes of the same size cancel out — one
    /// rule change dropped eight orders from Active and let eight different ones in, and the totals
    /// stayed put while the kitchen was shown the wrong tickets.
    /// </remarks>
    [RequiresPostgresFact]
    public async Task EachQueueHoldsExactlyTheOrdersTheRulesPutInIt()
    {
        await using var context = _database.CreateContext();
        var orders = context.Orders.AsNoTracking().Where(order => order.RestaurantId == _restaurantId);

        var everyOrder = await orders
            .Select(order => new { order.Id, order.Status, order.PaymentStatus, order.PaymentMethod, order.CreatedAt })
            .ToListAsync();
        var counts = await StaffOrderQueue.CountAsync(orders, Now, CancellationToken.None);
        var complaints = new List<string>();

        foreach (var queue in StaffOrderQueue.All)
        {
            var fromTheDatabase = (await orders
                .Where(StaffOrderQueue.Predicate(queue, Now))
                .Select(order => order.Id)
                .ToListAsync())
                .ToHashSet();

            var byTheRules = everyOrder
                .Where(order => StaffOrderQueue.Matches(
                    queue, order.Status, order.PaymentStatus, order.PaymentMethod, order.CreatedAt, Now))
                .Select(order => order.Id)
                .ToHashSet();

            foreach (var id in fromTheDatabase.Except(byTheRules))
            {
                var order = everyOrder.Single(candidate => candidate.Id == id);
                complaints.Add($"{queue} shows an order that does not belong in it: {order.Status}/{order.PaymentStatus}/{order.PaymentMethod}");
            }

            foreach (var id in byTheRules.Except(fromTheDatabase))
            {
                var order = everyOrder.Single(candidate => candidate.Id == id);
                complaints.Add($"{queue} is missing an order that belongs in it: {order.Status}/{order.PaymentStatus}/{order.PaymentMethod}");
            }

            if (counts[queue] != byTheRules.Count)
            {
                complaints.Add($"{queue}: the tab says {counts[queue]}, the queue holds {byTheRules.Count}");
            }
        }

        Assert.Empty(complaints);
    }

    /// <summary>Sorting rearranges orders; it does not create or destroy work.</summary>
    [RequiresPostgresFact]
    public async Task SortingTheOrdersDoesNotChangeHowMuchWorkThereIs()
    {
        await using var context = _database.CreateContext();
        var orders = context.Orders.AsNoTracking().Where(order => order.RestaurantId == _restaurantId);

        var newestFirst = await StaffOrderQueue.CountAsync(
            orders.OrderByDescending(order => order.CreatedAt), Now, CancellationToken.None);
        var oldestFirst = await StaffOrderQueue.CountAsync(
            orders.OrderBy(order => order.CreatedAt), Now, CancellationToken.None);

        Assert.Equal(newestFirst, oldestFirst);
    }

    /// <summary>
    /// Every order is somewhere. A queue that quietly drops orders would keep the tabs consistent with
    /// each other while still losing work.
    /// </summary>
    [RequiresPostgresFact]
    public async Task NoOrderFallsOutsideEveryQueue()
    {
        await using var context = _database.CreateContext();
        var orders = context.Orders.AsNoTracking().Where(order => order.RestaurantId == _restaurantId);

        var counts = await StaffOrderQueue.CountAsync(orders, Now, CancellationToken.None);
        var total = await orders.CountAsync();

        // "active" is the union of new, kitchen and ready, so counting it again would double up.
        Assert.Equal(total, counts["active"] + counts["payment"] + counts["carried"] + counts["closed"]);
        Assert.Equal(counts["active"], counts["new"] + counts["kitchen"] + counts["ready"]);
    }

    /// <summary>
    /// The counts describe the filters, not the page. Narrowing to one status has to move them.
    /// </summary>
    [RequiresPostgresFact]
    public async Task FiltersNarrowTheCounts()
    {
        await using var context = _database.CreateContext();
        var orders = context.Orders.AsNoTracking().Where(order => order.RestaurantId == _restaurantId);

        var everything = await StaffOrderQueue.CountAsync(orders, Now, CancellationToken.None);
        var readyOnly = await StaffOrderQueue.CountAsync(
            orders.Where(order => order.Status == OrderStatus.Ready), Now, CancellationToken.None);

        Assert.Equal(0, readyOnly["closed"]);
        Assert.Equal(0, readyOnly["new"]);
        Assert.True(readyOnly["ready"] > 0);
        Assert.True(everything["ready"] >= readyOnly["ready"]);
    }
}
