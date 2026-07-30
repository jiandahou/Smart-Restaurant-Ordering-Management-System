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
