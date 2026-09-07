using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>Something a reservation could not satisfy, named the way the ticket names it.</summary>
/// <param name="Name">The snapshot name, so a dish renamed since the order still reads correctly.</param>
/// <param name="IsModifier">Whether this is an extra rather than a dish, which staff read differently.</param>
public sealed record OrderStockShortage(string Name, bool IsModifier);

/// <summary>
/// What an order is holding, and how it gives it back or takes it again.
/// </summary>
/// <remarks>
/// <para>
/// Checking out reserves stock. Every path that closes an order has to give that stock back, and
/// every path that revives one has to take it again — and until this existed each path assembled
/// the quantities itself and called the stock service directly. Two of the three closing paths did
/// it; the third, the one staff use all day, did not, and no reviving path did it at all. Orders
/// rejected at the counter held their portions for good.
/// </para>
/// <para>
/// So the pairing lives in one place. Adding a fourth path that closes an order is now a question
/// with an obvious answer rather than a rule you have to already know.
/// </para>
/// <para>
/// Both halves run raw UPDATEs that take effect immediately rather than at
/// <c>SaveChanges</c> — so call them inside the caller's transaction, or a failure afterwards
/// leaves the stock moved and the order not.
/// </para>
/// </remarks>
public sealed class OrderStockLedger(AppDbContext dbContext, MenuItemStockService stockService)
{
    /// <summary>
    /// Gives back everything the order reserved, once.
    /// </summary>
    /// <remarks>
    /// An order that has already released does nothing here. Two paths can reasonably both decide
    /// an order is finished — a customer cancelling as the sweeper reaches it — and giving the
    /// portions back twice invents stock the kitchen does not have.
    /// </remarks>
    /// <returns>True when this call is what released the stock.</returns>
    public async Task<bool> ReleaseAsync(Order order, DateTime now, CancellationToken cancellationToken)
    {
        if (order.StockReleasedAt is not null)
        {
            return false;
        }

        // The tracked property above is only a fast path. It cannot be the concurrency guard:
        // two cancellation requests can load the same null value before either commits. Claim the
        // release in PostgreSQL instead, in the caller's transaction. The conditional UPDATE takes
        // the row lock; after the winner commits, the loser wakes, rechecks the predicate and
        // affects zero rows, so it must not add the portions a second time.
        if (dbContext.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "Order stock must be released inside the transaction that closes the order.");
        }

        var claimed = await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE "Orders"
            SET "StockReleasedAt" = {now}
            WHERE "Id" = {order.Id}
              AND "StockReleasedAt" IS NULL
            """,
            cancellationToken);

        if (claimed == 0)
        {
            return false;
        }

        await stockService.ReleaseAsync(
            OrderItemStock.RequestedQuantities(order.OrderItems),
            cancellationToken);
        await stockService.ReleaseOptionsAsync(
            OrderOptionStock.RequestedQuantities(order.OrderItems),
            cancellationToken);

        order.StockReleasedAt = now;
        return true;
    }

    /// <summary>
    /// Takes the stock the order needs, for reviving one that had been closed.
    /// </summary>
    /// <remarks>
    /// Partial reservations are left in place deliberately: the stock service decrements item by
    /// item and cannot undo the ones that succeeded, so a caller that gets a shortage back must
    /// roll its transaction back. Reporting the shortage and letting the caller keep the portions
    /// would oversell exactly the dish this is guarding.
    /// </remarks>
    /// <returns>What could not be reserved. Empty means the order has everything it needs.</returns>
    public async Task<IReadOnlyList<OrderStockShortage>> TryReserveAsync(
        Order order,
        CancellationToken cancellationToken)
    {
        // Never released, so still holding: there is nothing to take back and taking it anyway
        // would deduct the same portions a second time. This is the state every order closed
        // before the ledger existed is in.
        if (order.StockReleasedAt is null)
        {
            return [];
        }

        var shortages = new List<OrderStockShortage>();

        var unavailableItemIds = await stockService.TryReserveAsync(
            OrderItemStock.RequestedQuantities(order.OrderItems),
            cancellationToken);

        foreach (var menuItemId in unavailableItemIds)
        {
            shortages.Add(new OrderStockShortage(NameOfItem(order, menuItemId), IsModifier: false));
        }

        var unavailableOptionIds = await stockService.TryReserveOptionsAsync(
            OrderOptionStock.RequestedQuantities(order.OrderItems),
            cancellationToken);

        foreach (var optionId in unavailableOptionIds)
        {
            shortages.Add(new OrderStockShortage(NameOfOption(order, optionId), IsModifier: true));
        }

        if (shortages.Count == 0)
        {
            order.StockReleasedAt = null;
        }

        return shortages;
    }

    private static string NameOfItem(Order order, Guid menuItemId) =>
        order.OrderItems.FirstOrDefault(item => item.MenuItemId == menuItemId)?.MenuItemNameSnapshot
        ?? "An item on this order";

    private static string NameOfOption(Order order, Guid optionId) =>
        order.OrderItems
            .SelectMany(item => item.SelectedOptions)
            .FirstOrDefault(option => option.MenuItemOptionId == optionId)?.OptionNameSnapshot
        ?? "An extra on this order";
}
