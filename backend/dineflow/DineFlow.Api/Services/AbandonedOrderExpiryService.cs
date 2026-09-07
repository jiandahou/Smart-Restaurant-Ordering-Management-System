using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Releases what an unpaid order is holding once it has been abandoned.
/// </summary>
/// <remarks>
/// <para>
/// Checking out reserves stock and takes a pickup number before any payment. Releasing them only
/// ever happened when somebody cancelled the order, so a customer who reached the payment screen
/// and walked away held those portions forever — and could do it again, and again, with no account
/// and no payment, until the dish showed as sold out having sold nothing.
/// </para>
/// <para>
/// Kept separate from <see cref="UnacceptableOrderRefundService"/> on purpose. That service exists
/// to give money back; here there is no money to give back, and nothing to tell the customer that
/// they do not already know — they were shown the deadline when they left.
/// </para>
/// </remarks>
public sealed class AbandonedOrderExpiryService(
    IServiceScopeFactory scopeFactory,
    ILogger<AbandonedOrderExpiryService> logger) : BackgroundService
{
    /// <summary>
    /// Frequent relative to the 20 minute deadline, so stock comes back promptly once it is due
    /// without the sweep itself becoming load.
    /// </summary>
    internal static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(2);

    internal const int BatchSize = 50;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(ScanInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await ExpireBatchAsync(stoppingToken);
        }
    }

    internal async Task<int> ExpireBatchAsync(CancellationToken cancellationToken)
    {
        var expired = 0;

        try
        {
            using var scope = scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stockLedger = scope.ServiceProvider.GetRequiredService<OrderStockLedger>();
            var checkoutSessionExpiry = scope.ServiceProvider.GetRequiredService<StripeCheckoutSessionExpiry>();

            var now = DateTime.UtcNow;
            var cutoff = now - AbandonedOrderPolicy.ExpiresAfter;

            var candidates = await dbContext.Orders
                .Include(order => order.OrderItems)
                    // The modifiers have to come with the items: releasing stock reads them, and
                    // without them it quietly releases nothing at all.
                    .ThenInclude(item => item.SelectedOptions)
                .Include(order => order.Payments)
                .Where(order =>
                    order.Status == OrderStatus.Pending &&
                    order.CreatedAt <= cutoff &&
                    // Counter orders sit Unpaid on purpose and are never abandoned in this sense.
                    order.PaymentMethod != PaymentMethod.PayAtCounter &&
                    (order.PaymentStatus == PaymentStatus.Unpaid ||
                     order.PaymentStatus == PaymentStatus.Failed ||
                     order.PaymentStatus == PaymentStatus.Expired ||
                     order.PaymentStatus == PaymentStatus.Cancelled ||
                     // Pending means a checkout session was created and nothing has come back. It
                     // was excluded on the reasoning that the customer might be on the card form —
                     // but that reasoning has no clock in it, and the exclusion held for as long as
                     // Stripe kept the session alive. The deadline the customer is shown is twenty
                     // minutes; reaching the payment screen quietly turned it into an hour, and the
                     // portions stayed gone for the whole of it. Whether anyone is still paying is
                     // now asked of Stripe rather than assumed, below.
                     order.PaymentStatus == PaymentStatus.Pending))
                .OrderBy(order => order.CreatedAt)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            foreach (var order in candidates)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                // Money already taken is the one state no sweep may touch, whatever the order says
                // about itself. Everything else — including a live checkout session — is settled
                // with Stripe inside the transaction below, where a session that turns out to have
                // been paid can still call the whole thing off.
                if (order.Payments.Any(payment => payment.Status == PaymentStatus.Paid))
                {
                    continue;
                }

                if (await ExpireOrderAsync(dbContext, stockLedger, checkoutSessionExpiry, order, now, cancellationToken))
                {
                    expired++;
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Sweep for abandoned unpaid orders failed.");
        }

        return expired;
    }

    private async Task<bool> ExpireOrderAsync(
        AppDbContext dbContext,
        OrderStockLedger stockLedger,
        StripeCheckoutSessionExpiry checkoutSessionExpiry,
        Order order,
        DateTime now,
        CancellationToken cancellationToken)
    {
        const string reason = "This order was not paid for within 20 minutes, so it was released.";

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            order.Status = OrderStatus.Cancelled;
            order.PaymentStatus = PaymentStatus.Cancelled;
            order.UpdatedAt = now;

            // Closed alongside the order, including the ones whose status still reads Pending but
            // which can take nothing: leaving a row that says a payment is in flight on an order
            // that has been given up on is the inconsistency this sweep exists to clear, not one to
            // leave behind.
            foreach (var payment in order.Payments.Where(payment =>
                         AbandonedOrderPolicy.HasNoPaymentInFlight(payment.Status)
                         || !AbandonedOrderPolicy.CanStillTakeMoney(
                             payment.Status,
                             payment.ProviderCheckoutSessionId,
                             payment.ProviderPaymentIntentId)))
            {
                payment.Status = PaymentStatus.Cancelled;
                payment.UpdatedAt = now;
            }

            // Asked for before the portions go back. An order the sweeper has given up on can still
            // have a hosted page a customer left open, and until Stripe's own timeout that page is
            // chargeable for stock this line is about to hand to someone else.
            //
            // And the answer is now a condition rather than a courtesy. Every live session has to
            // come back confirmed unchargeable before anything is released: Stripe is the only
            // party that knows whether the customer finished paying in the seconds this sweep was
            // deciding they had not, and it is the only party that can make the page stop working.
            var liveSessions = order.Payments.Count(StripeCheckoutSessionExpiry.IsStillChargeable);
            var closedSessions = await checkoutSessionExpiry.ExpireOpenSessionsAsync(
                order,
                "abandoned-order-sweep",
                cancellationToken);

            if (closedSessions < liveSessions)
            {
                // Either somebody paid while this ran, or Stripe could not be reached. Both mean
                // the same thing here: this order is not ours to release yet. Rolled back rather
                // than skipped so the half-applied expiries go with it, and tried again next sweep.
                await transaction.RollbackAsync(cancellationToken);
                logger.LogInformation(
                    "Left {OrderNumber} alone: {Closed} of {Live} checkout sessions could be confirmed closed.",
                    order.OrderNumber,
                    closedSessions,
                    liveSessions);
                return false;
            }

            // The whole point of the sweep. Without this the order is merely tidied away while the
            // portions it reserved stay gone.
            await stockLedger.ReleaseAsync(order, now, cancellationToken);

            dbContext.OrderStatusHistories.Add(new OrderStatusHistory
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                PreviousStatus = OrderStatus.Pending,
                NewStatus = OrderStatus.Cancelled,
                // Named so staff reading the history can tell this from a customer changing their
                // mind, which looks identical in the order list otherwise.
                Action = "AutoExpireUnpaid",
                Reason = reason,
                CreatedAt = now
            });

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            logger.LogInformation(
                "Released abandoned unpaid order {OrderNumber} after {Minutes} minutes.",
                order.OrderNumber,
                AbandonedOrderPolicy.ExpiresAfter.TotalMinutes);

            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            await transaction.RollbackAsync(cancellationToken);
            logger.LogError(
                exception,
                "Could not release abandoned unpaid order {OrderNumber}.",
                order.OrderNumber);
            return false;
        }
    }
}
