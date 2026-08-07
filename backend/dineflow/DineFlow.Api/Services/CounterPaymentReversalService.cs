using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed record CounterReversalResult(bool IsSuccess, int StatusCode, string? Message = null)
{
    public static CounterReversalResult Success() => new(true, StatusCodes.Status200OK);

    public static CounterReversalResult Failure(int statusCode, string message) =>
        new(false, statusCode, message);
}

/// <summary>
/// Reverses money taken at the counter. Kept separate from OrderRefundProcessor on purpose: that
/// one talks to Stripe and can confirm what happened, whereas everything here is a record of a
/// physical act the system cannot verify.
/// </summary>
public sealed class CounterPaymentReversalService(
    AppDbContext dbContext,
    OrderRealtimeNotifier orderRealtimeNotifier,
    ReportLogWriter reportLogWriter,
    ILogger<CounterPaymentReversalService> logger)
{
    /// Cancels a counter payment outright and puts the order back to unpaid so it can be collected
    /// again — for "we rang it up wrong", not for giving money back on a valid sale.
    public async Task<CounterReversalResult> VoidAsync(
        Payment payment,
        Order order,
        string? actorUserId,
        string? reason,
        CancellationToken cancellationToken)
    {
        if (!CounterPaymentPolicy.IsValidReason(reason))
        {
            return CounterReversalResult.Failure(
                StatusCodes.Status400BadRequest,
                "A reason is required to void a counter payment.");
        }

        // Serialise against every other reversal of this payment before deciding anything: the
        // snapshot the controller loaded may already be stale.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await LockAndRefreshPaymentAsync(payment, cancellationToken);

        if (!CounterPaymentPolicy.CanVoid(
                payment.Provider,
                payment.Status,
                payment.Refunds.Count > 0,
                payment.VoidedAt))
        {
            return CounterReversalResult.Failure(
                StatusCodes.Status409Conflict,
                "This payment can no longer be voided. Record an offline refund instead.");
        }

        var now = DateTime.UtcNow;
        var trimmedReason = reason!.Trim();

        payment.Status = PaymentStatus.Cancelled;
        payment.VoidedAt = now;
        payment.VoidedByUserId = actorUserId;
        payment.VoidReason = trimmedReason;
        payment.UpdatedAt = now;

        // The sale still stands, so the order goes back to owing money rather than being cancelled.
        order.PaymentStatus = PaymentStatus.Unpaid;
        order.UpdatedAt = now;

        reportLogWriter.AddAudit(
            "Payment.CounterVoided",
            "Payment",
            payment.Id.ToString(),
            order.RestaurantId,
            $"Counter payment voided for {order.OrderNumber}.",
            after: new
            {
                paymentId = payment.Id,
                orderId = order.Id,
                order.OrderNumber,
                payment.AmountCents,
                payment.Currency,
                payment.Provider,
                payment.TenderType,
                reason = trimmedReason,
                actorUserId
            });
        reportLogWriter.AddOrderEvent(
            order,
            "payment.counter_voided",
            $"Counter payment voided for {order.OrderNumber}.",
            new { paymentId = payment.Id, payment.AmountCents, reason = trimmedReason, actorUserId });
        reportLogWriter.AddPaymentEvent(
            order,
            payment,
            null,
            "counter.voided",
            null,
            payment.Status.ToString(),
            $"Counter payment voided: {trimmedReason}",
            new { payment.AmountCents, payment.Currency, actorUserId });

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        // Only announce once the reversal is durable.
        await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

        logger.LogInformation(
            "Counter payment {PaymentId} voided by {ActorUserId}.",
            payment.Id,
            actorUserId ?? "(unknown)");

        return CounterReversalResult.Success();
    }

    /// Records money already handed back at the counter. Written as a PaymentRefund so the
    /// refunded/refundable maths, history UI and reporting all keep working, but marked succeeded
    /// immediately because there is no provider to wait on.
    public async Task<CounterReversalResult> RefundAsync(
        Payment payment,
        Order order,
        long amountCents,
        string? actorUserId,
        string? reason,
        CancellationToken cancellationToken)
    {
        if (!CounterPaymentPolicy.IsValidReason(reason))
        {
            return CounterReversalResult.Failure(
                StatusCodes.Status400BadRequest,
                "A reason is required to record an offline refund.");
        }

        // The balance must be read under the same lock that guards the write, or two cashiers can
        // both see a full balance and between them refund more than was ever collected.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await LockAndRefreshPaymentAsync(payment, cancellationToken);

        if (!CounterPaymentPolicy.CanOfflineRefund(payment.Provider, payment.Status, payment.VoidedAt))
        {
            return CounterReversalResult.Failure(
                StatusCodes.Status409Conflict,
                "This payment cannot be refunded at the counter.");
        }

        var alreadyRefunded = payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);
        var refundable = payment.AmountCents - alreadyRefunded;

        if (!CounterPaymentPolicy.IsValidRefundAmount(amountCents, refundable))
        {
            return CounterReversalResult.Failure(
                StatusCodes.Status409Conflict,
                $"Refund amount must be between 1 and {refundable} cents.");
        }

        var now = DateTime.UtcNow;
        var trimmedReason = reason!.Trim();

        var refund = new PaymentRefund
        {
            Id = Guid.NewGuid(),
            PaymentId = payment.Id,
            Payment = payment,
            OrderId = order.Id,
            Provider = payment.Provider,
            AmountCents = amountCents,
            Currency = payment.Currency,
            // No provider round trip to wait for — the money is already out of the drawer.
            Status = PaymentRefundStatus.Succeeded,
            Reason = trimmedReason,
            RequestedByUserId = actorUserId,
            CreatedAt = now,
            UpdatedAt = now,
            RefundedAt = now
        };
        dbContext.PaymentRefunds.Add(refund);
        payment.Refunds.Add(refund);

        var totalRefunded = alreadyRefunded + amountCents;
        payment.Status = totalRefunded >= payment.AmountCents
            ? PaymentStatus.Refunded
            : PaymentStatus.PartiallyRefunded;
        payment.UpdatedAt = now;
        order.PaymentStatus = payment.Status;
        order.UpdatedAt = now;

        reportLogWriter.AddAudit(
            "Payment.CounterRefunded",
            "PaymentRefund",
            refund.Id.ToString(),
            order.RestaurantId,
            $"Offline refund recorded for {order.OrderNumber}.",
            after: new
            {
                refundId = refund.Id,
                paymentId = payment.Id,
                orderId = order.Id,
                order.OrderNumber,
                amountCents,
                payment.Currency,
                payment.Provider,
                payment.TenderType,
                reason = trimmedReason,
                actorUserId
            });
        reportLogWriter.AddOrderEvent(
            order,
            "payment.counter_refunded",
            $"Offline refund recorded for {order.OrderNumber}.",
            new { refundId = refund.Id, amountCents, reason = trimmedReason, actorUserId });
        reportLogWriter.AddPaymentEvent(
            order,
            payment,
            refund,
            "counter.refunded",
            null,
            refund.Status.ToString(),
            $"Offline refund recorded: {trimmedReason}",
            new { amountCents, payment.Currency, actorUserId });

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

        logger.LogInformation(
            "Offline refund {RefundId} of {AmountCents} recorded by {ActorUserId}.",
            refund.Id,
            amountCents,
            actorUserId ?? "(unknown)");

        return CounterReversalResult.Success();
    }

    /// Takes a row lock on the payment and re-reads it plus its refunds, so every decision that
    /// follows is made against committed state rather than whatever the request loaded earlier.
    /// A concurrent reversal blocks here until the first one commits.
    private async Task LockAndRefreshPaymentAsync(Payment payment, CancellationToken cancellationToken)
    {
        _ = await dbContext.Payments
            .FromSql($"SELECT * FROM \"Payments\" WHERE \"Id\" = {payment.Id} FOR UPDATE")
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        await dbContext.Entry(payment).ReloadAsync(cancellationToken);
        await dbContext.Entry(payment)
            .Collection(item => item.Refunds)
            .Query()
            .LoadAsync(cancellationToken);
    }
}
