using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Reserves menu item stock when an order is placed.
///
/// Stock is opt-in: a NULL <c>StockQuantity</c> means untracked/unlimited, which is the case for
/// most items. Tracked items must not oversell, so the decrement is a single guarded statement
/// rather than a read-then-write — two customers checking out at once would otherwise both see the
/// last portion available.
/// </summary>
public sealed class MenuItemStockService(AppDbContext dbContext)
{
    /// <summary>
    /// Reserves the requested quantities. Returns the ids that could not be satisfied; an empty
    /// list means every tracked item had enough stock. Untracked items always succeed and are left
    /// untouched.
    ///
    /// Call inside the caller's transaction: a reservation is only correct if it commits together
    /// with the order it was made for.
    /// </summary>
    public async Task<IReadOnlyList<Guid>> TryReserveAsync(
        IReadOnlyDictionary<Guid, int> quantitiesByMenuItemId,
        CancellationToken cancellationToken)
    {
        var unavailable = new List<Guid>();

        foreach (var (menuItemId, quantity) in quantitiesByMenuItemId)
        {
            if (quantity <= 0)
            {
                continue;
            }

            // Untracked rows match the NULL branch and are updated to their existing values, so
            // they still report one affected row without changing anything.
            var affected = await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "MenuItems"
                SET "StockQuantity" = CASE
                        WHEN "StockQuantity" IS NULL THEN NULL
                        ELSE "StockQuantity" - {quantity}
                    END,
                    "IsSoldOut" = CASE
                        WHEN "StockQuantity" IS NULL THEN "IsSoldOut"
                        ELSE ("StockQuantity" - {quantity}) <= 0
                    END
                WHERE "Id" = {menuItemId}
                  AND ("StockQuantity" IS NULL OR "StockQuantity" >= {quantity})
                """,
                cancellationToken);

            if (affected == 0)
            {
                unavailable.Add(menuItemId);
            }
        }

        return unavailable;
    }

    /// <summary>
    /// Reserves modifier stock, in units of the modifier.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A limited-supply extra — the last of the day's truffle, a sauce made in one batch — runs out
    /// like a dish does, and only the dish was counted. The kitchen found out at the pass, one
    /// ticket at a time.
    /// </para>
    /// <para>
    /// The quantities passed in are already multiplied out: two spring rolls each taking three extra
    /// rolls is six, not two and not three. Getting that wrong is how a tracked extra oversells while
    /// every line on the order looks correct on its own.
    /// </para>
    /// <para>
    /// Same guarded single statement as the dish, and for the same reason: two customers checking
    /// out at once would otherwise both be sold the last portion.
    /// </para>
    /// </remarks>
    public async Task<IReadOnlyList<Guid>> TryReserveOptionsAsync(
        IReadOnlyDictionary<Guid, int> quantitiesByOptionId,
        CancellationToken cancellationToken)
    {
        var unavailable = new List<Guid>();

        foreach (var (optionId, quantity) in quantitiesByOptionId)
        {
            if (quantity <= 0)
            {
                continue;
            }

            var affected = await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "MenuItemOptions"
                SET "StockQuantity" = CASE
                        WHEN "StockQuantity" IS NULL THEN NULL
                        ELSE "StockQuantity" - {quantity}
                    END
                WHERE "Id" = {optionId}
                  AND ("StockQuantity" IS NULL OR "StockQuantity" >= {quantity})
                """,
                cancellationToken);

            if (affected == 0)
            {
                unavailable.Add(optionId);
            }
        }

        return unavailable;
    }

    /// <summary>Returns modifier stock, alongside the dish it was ordered with.</summary>
    public async Task ReleaseOptionsAsync(
        IReadOnlyDictionary<Guid, int> quantitiesByOptionId,
        CancellationToken cancellationToken)
    {
        foreach (var (optionId, quantity) in quantitiesByOptionId)
        {
            if (quantity <= 0)
            {
                continue;
            }

            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "MenuItemOptions"
                SET "StockQuantity" = "StockQuantity" + {quantity}
                WHERE "Id" = {optionId}
                  AND "StockQuantity" IS NOT NULL
                """,
                cancellationToken);
        }
    }

    /// <summary>
    /// Returns stock to tracked items, for example when an order is cancelled or rejected. Items
    /// that come back above zero stop being sold out.
    /// </summary>
    public async Task ReleaseAsync(
        IReadOnlyDictionary<Guid, int> quantitiesByMenuItemId,
        CancellationToken cancellationToken)
    {
        foreach (var (menuItemId, quantity) in quantitiesByMenuItemId)
        {
            if (quantity <= 0)
            {
                continue;
            }

            await dbContext.Database.ExecuteSqlInterpolatedAsync(
                $"""
                UPDATE "MenuItems"
                SET "StockQuantity" = "StockQuantity" + {quantity},
                    "IsSoldOut" = false
                WHERE "Id" = {menuItemId}
                  AND "StockQuantity" IS NOT NULL
                """,
                cancellationToken);
        }
    }
}
