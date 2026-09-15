using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// What happens to an order the moment its money arrives.
/// </summary>
/// <remarks>
/// <para>
/// Three places learn that a payment succeeded — the two Stripe webhooks and the reconciliation
/// sync — and all three did the same single thing: try to accept the order. That is right for an
/// order still waiting to be made, and wrong for one the restaurant has already turned away.
/// </para>
/// <para>
/// The gap is not hypothetical. Cancelling an order asks Stripe to close its checkout page, and
/// that request can fail — Stripe unreachable, the session already gone — in which case the page
/// stays chargeable and the customer, who still has the tab open, pays for an order that no longer
/// exists. The payment then landed on a rejected order, was recorded as Paid, and nothing looked at
/// it again: no refund, no email, no queue, no screen. The only trace was one log line.
/// </para>
/// <para>
/// Refunding automatically rather than flagging for staff is the rule this codebase already holds:
/// rejecting a paid order refunds it, on the reasoning that nobody is coming to make the food so
/// holding the money serves no one. Money that arrives a moment later is the same situation with
/// worse timing. When the refund cannot be made the order becomes an unsettled closure, which the
/// staff screen now shows on its payment tab.
/// </para>
/// </remarks>
public sealed class OrderPaymentLanding(
    AppDbContext dbContext,
    OrderAutoAcceptanceService autoAcceptance,
    OrderRefundProcessor refundProcessor,
    ReportLogWriter reportLogWriter,
    ILogger<OrderPaymentLanding> logger)
{
    /// <summary>
    /// Called where the order is first known to be paid, in place of accepting it outright.
    /// </summary>
    public async Task OnPaidAsync(Order order, string? actorUserId, CancellationToken cancellationToken)
    {
        if (order.Status is not (OrderStatus.Cancelled or OrderStatus.Rejected))
        {
            await autoAcceptance.TryAcceptAsync(order, cancellationToken);
            return;
        }

        await RefundMoneyForAnOrderNobodyWillMakeAsync(order, actorUserId, cancellationToken);
    }

    private async Task RefundMoneyForAnOrderNobodyWillMakeAsync(
        Order order,
        string? actorUserId,
        CancellationToken cancellationToken)
    {
        // Loaded here rather than trusted from the caller. Three call sites reach this with three
        // different include graphs, and a refund policy that reads an unloaded collection quietly
        // decides nothing is owed — which is the failure this whole class exists to remove.
        await EnsurePaymentsLoadedAsync(order, cancellationToken);

        var owed = TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false);

        if (owed is null)
        {
            return;
        }

        logger.LogWarning(
            "Payment landed on {OrderNumber} after it was {Status}. Refunding {Amount} cents.",
            order.OrderNumber,
            order.Status,
            owed.Value);

        var result = await refundProcessor.RefundAsync(
            order,
            requestedByUserId: actorUserId,
            reason: $"Payment arrived after the order was {order.Status.ToString().ToLowerInvariant()}.",
            source: "payment-after-closure",
            cancellationToken,
            // Seeded on the order so a webhook Stripe delivers twice cannot refund twice.
            idempotencyKeySeed: $"payment-after-closure:{order.Id}",
            requestedAmountCents: owed.Value,
            customerExplanation: TurnedAwayOrderRefund.CustomerExplanation(order.Status));

        if (result.IsSuccess)
        {
            reportLogWriter.AddAudit(
                "Order.PaymentAfterClosureRefunded",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"{order.OrderNumber}: {owed.Value} cents arrived after the order was {order.Status} and were refunded.",
                before: new { status = order.Status.ToString(), amountOwedCents = owed.Value },
                after: new { refunded = true });
            return;
        }

        // Another attempt already has this in hand, so there is nothing wrong and nobody to tell.
        //
        // Two things learn that a payment succeeded and they race: the customer's browser returning
        // to the success page asks the API to sync, and Stripe's webhook arrives on its own. Both
        // land within a few hundred milliseconds, and both reach here. The refund processor's own
        // guard means only one refund is ever created — the loser is told a refund is already
        // pending, which is the guard working rather than money going missing.
        //
        // Recorded as a failure it was worse than useless: an audit line saying the customer's
        // money could not be returned, written while the refund that returned it was in flight.
        // That line is the one a person is meant to act on, and it must not cry wolf.
        if (result.StatusCode == StatusCodes.Status409Conflict)
        {
            logger.LogInformation(
                "A refund for {OrderNumber} was already under way when a second notice of the same payment arrived.",
                order.OrderNumber);
            return;
        }

        // Not thrown. This runs inside a Stripe webhook, and failing it would have Stripe redeliver
        // the event — replaying the payment update — for a refund that will fail again the same way.
        // The order is left as an unsettled closure instead, which the staff payment tab now shows.
        logger.LogError(
            "Payment of {Amount} cents landed on {OrderNumber} after it was {Status} and could not be refunded: {Message}",
            owed.Value,
            order.OrderNumber,
            order.Status,
            result.Message);

        reportLogWriter.AddAudit(
            "Order.PaymentAfterClosureRefundFailed",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"{order.OrderNumber}: {owed.Value} cents arrived after the order was {order.Status} and could not be refunded — {result.Message}",
            before: new { status = order.Status.ToString(), amountOwedCents = owed.Value },
            after: new { refunded = false, message = result.Message });
    }

    private async Task EnsurePaymentsLoadedAsync(Order order, CancellationToken cancellationToken)
    {
        var entry = dbContext.Entry(order);

        if (entry.State == EntityState.Detached)
        {
            return;
        }

        var payments = entry.Collection(loaded => loaded.Payments);

        if (!payments.IsLoaded)
        {
            await payments.LoadAsync(cancellationToken);
        }

        foreach (var payment in order.Payments)
        {
            var refunds = dbContext.Entry(payment).Collection(loaded => loaded.Refunds);

            if (!refunds.IsLoaded)
            {
                await refunds.LoadAsync(cancellationToken);
            }
        }
    }
}
