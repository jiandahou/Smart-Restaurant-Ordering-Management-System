using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Decides whether a restaurant can be deleted and, when it can, clears the records that would
/// otherwise be left pointing at a restaurant id that no longer exists.
///
/// Two different problems live here. Trading history (orders, staff, carts, table sessions) is
/// protected by RESTRICT foreign keys, so attempting the delete throws a <see cref="DbUpdateException"/>
/// the caller cannot explain to an operator — those are counted up front instead. Tables, pickup
/// counters and printing rows are the opposite: they carry a plain RestaurantId with no foreign key,
/// so nothing stops the delete and nothing cleans them up either.
/// </summary>
public static class RestaurantDeletionPolicy
{
    private static readonly (string Key, string Singular, string Plural)[] BlockerLabels =
    [
        ("orders", "order", "orders"),
        ("staff", "staff account", "staff accounts"),
        ("carts", "open cart", "open carts"),
        ("tableSessions", "table session", "table sessions"),
    ];

    /// <summary>
    /// Counts the records a restaurant delete cannot take with it. Audit, order and payment event
    /// logs are deliberately excluded: they outlive the restaurant on purpose.
    /// </summary>
    public static async Task<IReadOnlyDictionary<string, int>> FindBlockersAsync(
        AppDbContext dbContext,
        Guid restaurantId,
        CancellationToken cancellationToken = default)
    {
        var counts = new Dictionary<string, int>
        {
            ["orders"] = await dbContext.Orders
                .CountAsync(order => order.RestaurantId == restaurantId, cancellationToken),
            ["staff"] = await dbContext.Users
                .CountAsync(user => user.RestaurantId == restaurantId, cancellationToken),
            ["carts"] = await dbContext.Carts
                .CountAsync(cart => cart.RestaurantId == restaurantId, cancellationToken),
            ["tableSessions"] = await dbContext.TableSessions
                .CountAsync(session => session.RestaurantId == restaurantId, cancellationToken),
        };

        return counts
            .Where(entry => entry.Value > 0)
            .ToDictionary(entry => entry.Key, entry => entry.Value);
    }

    /// <summary>Turns the blocker counts into something an operator can act on.</summary>
    public static string DescribeBlockers(IReadOnlyDictionary<string, int> blockers)
    {
        var parts = BlockerLabels
            .Where(label => blockers.ContainsKey(label.Key) && blockers[label.Key] > 0)
            .Select(label =>
            {
                var count = blockers[label.Key];
                return $"{count} {(count == 1 ? label.Singular : label.Plural)}";
            })
            .ToList();

        return parts.Count switch
        {
            0 => string.Empty,
            1 => parts[0],
            _ => $"{string.Join(", ", parts.Take(parts.Count - 1))} and {parts[^1]}",
        };
    }

    /// <summary>
    /// Marks the restaurant's own records for deletion. Menu categories (and the items and options
    /// beneath them) cascade with the restaurant row and are left to the database. These four do not
    /// cascade, so without this they survive as orphans. Callers save and commit.
    /// </summary>
    public static async Task RemoveOwnedRecordsAsync(
        AppDbContext dbContext,
        Guid restaurantId,
        CancellationToken cancellationToken = default)
    {
        dbContext.PrintJobs.RemoveRange(
            await dbContext.PrintJobs
                .Where(job => job.RestaurantId == restaurantId)
                .ToListAsync(cancellationToken));
        dbContext.PrintStations.RemoveRange(
            await dbContext.PrintStations
                .Where(station => station.RestaurantId == restaurantId)
                .ToListAsync(cancellationToken));
        dbContext.RestaurantTables.RemoveRange(
            await dbContext.RestaurantTables
                .Where(table => table.RestaurantId == restaurantId)
                .ToListAsync(cancellationToken));
        dbContext.RestaurantPickupCounters.RemoveRange(
            await dbContext.RestaurantPickupCounters
                .Where(counter => counter.RestaurantId == restaurantId)
                .ToListAsync(cancellationToken));
    }
}
