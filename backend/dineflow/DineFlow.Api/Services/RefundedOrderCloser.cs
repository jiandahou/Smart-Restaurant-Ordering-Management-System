using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Closes an order that has been paid back in full, and gives back what it was holding.
/// </summary>
/// <remarks>
/// <para>
/// The rule itself is <see cref="RefundedOrderClosure"/>: money and food have to agree, so an order
/// refunded in full before anything left the pass is off, and one refunded after the food exists
/// keeps its history. That rule was already written down. What was missing was anywhere consistent
/// to apply it.
/// </para>
/// <para>
/// Only the refund-request approval closed anything, so a refund issued directly by an
/// administrator, or handed back across the counter, left an order reading Accepted with the money
/// already returned — the kitchen cooking something nobody had paid for. And even that one path
/// closed the order without releasing its stock, because it set the status directly instead of
/// going through a path that knew about reservations. The portions stayed committed to an order
/// that had just been cancelled.
/// </para>
/// <para>
/// So closing and releasing are one operation here, reached from every path that can settle a
/// refund. Deciding the consequence is all it does: the refund is its own recorded action with its
/// own amount and audit trail, and a status change must never be the thing that moves money.
/// </para>
/// </remarks>
public sealed class RefundedOrderCloser(
    AppDbContext dbContext,
    OrderStockLedger stockLedger,
    ReportLogWriter reportLogWriter)
{
    /// <summary>
    /// Closes the order if this refund settled it, releasing its stock in the same act.
    /// </summary>
    /// <remarks>
    /// Runs inside the caller's transaction when there is one, and opens its own when there is not:
    /// the status change and the portions going back have to commit together, or the kitchen is
    /// told an order is off while its ingredients stay spoken for.
    /// </remarks>
    /// <returns>True when this call closed the order.</returns>
    public async Task<bool> CloseIfFullyRefundedAsync(
        Order? order,
        string? actorUserId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (order is null)
        {
            return false;
        }

        await EnsurePaymentsLoadedAsync(order, cancellationToken);

        // Every payment that was actually collected, including one already marked Refunded.
        //
        // Counting only Paid and PartiallyRefunded made the answer depend on the order of two
        // writes: a caller that flipped the payment to Refunded before asking found no collected
        // money at all, decided nothing had been refunded in full, and closed nothing. It happened
        // to work in the one place this rule was used, because that path asked first — which is
        // exactly the kind of correctness that stops being true the moment somebody calls it from
        // anywhere else.
        var paidCents = order.Payments
            .Where(payment => payment.Status is PaymentStatus.Paid
                or PaymentStatus.PartiallyRefunded
                or PaymentStatus.Refunded)
            .Sum(payment => payment.AmountCents);
        // Distinct, because this total decides whether an order is cancelled and its stock handed
        // back. A collection that happens to hold the same refund twice — one over-eager Add away —
        // would turn a partial refund into a cancellation, and the shop would find out by having
        // made food for an order that no longer exists.
        var refundedCents = order.Payments
            .SelectMany(payment => payment.Refunds)
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .DistinctBy(refund => refund.Id)
            .Sum(refund => refund.AmountCents);

        var closure = RefundedOrderClosure.ClosureFor(order.Status, paidCents, refundedCents);
        if (closure is null)
        {
            return false;
        }

        var owned = dbContext.Database.CurrentTransaction is null;
        var transaction = owned
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        try
        {
            var previousStatus = order.Status;
            order.Status = closure.Value;
            order.UpdatedAt = now;

            // The portions go back with the order, the way they do on every other path that closes
            // one. Setting the status alone was what left a cancelled order still holding stock.
            await stockLedger.ReleaseAsync(order, now, cancellationToken);

            dbContext.OrderStatusHistories.Add(new OrderStatusHistory
            {
                OrderId = order.Id,
                PreviousStatus = previousStatus,
                NewStatus = closure.Value,
                Action = OrderTransitionAction.Cancel.ToString(),
                Reason = RefundedOrderClosure.CustomerExplanation,
                ChangedByUserId = actorUserId,
                CreatedAt = now,
            });

            reportLogWriter.AddOrderEvent(
                order,
                "order.closed_after_full_refund",
                $"{order.OrderNumber}: {previousStatus} -> {closure.Value} after a full refund.",
                new
                {
                    previousStatus = previousStatus.ToString(),
                    newStatus = closure.Value.ToString(),
                    paidCents,
                    refundedCents,
                });

            if (owned)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction!.CommitAsync(cancellationToken);
            }

            return true;
        }
        finally
        {
            if (transaction is not null)
            {
                await transaction.DisposeAsync();
            }
        }
    }

    /// <summary>
    /// The totals are read off the order's payments, so they have to actually be there.
    /// </summary>
    /// <remarks>
    /// A caller that loaded the order without them would compute nothing paid and nothing refunded,
    /// and quietly decide the order was not settled — the same silent, unfalsifiable no-op that hid
    /// the stock bug this class exists to fix.
    /// </remarks>
    private async Task EnsurePaymentsLoadedAsync(Order order, CancellationToken cancellationToken)
    {
        var entry = dbContext.Entry(order);
        if (entry.State == EntityState.Detached)
        {
            return;
        }

        var payments = entry.Collection(item => item.Payments);
        if (!payments.IsLoaded)
        {
            await payments.Query().Include(payment => payment.Refunds).LoadAsync(cancellationToken);
            return;
        }

        foreach (var payment in order.Payments)
        {
            var refunds = dbContext.Entry(payment).Collection(item => item.Refunds);
            if (!refunds.IsLoaded)
            {
                await refunds.LoadAsync(cancellationToken);
            }
        }
    }
}
