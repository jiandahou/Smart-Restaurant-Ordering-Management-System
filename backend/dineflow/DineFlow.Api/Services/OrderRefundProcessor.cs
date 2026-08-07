using DineFlow.Api.Options;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using Stripe;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Api.Services;

public sealed class OrderRefundProcessor
{
    private const string OrderIdMetadataKey = "orderId";
    private const string PaymentIdMetadataKey = "paymentId";
    private const string RefundIdMetadataKey = "refundId";

    private readonly AppDbContext _dbContext;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly PaymentNotificationService _paymentNotificationService;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly ILogger<OrderRefundProcessor> _logger;

    private enum PendingRefundReconciliationOutcome
    {
        RetryExisting,
        AwaitingProvider,
        Succeeded,
        Failed
    }

    private sealed record PendingRefundReconciliationResult(
        PendingRefundReconciliationOutcome Outcome,
        PaymentRefund Refund,
        int StatusCode = StatusCodes.Status409Conflict,
        string? Detail = null);

    public OrderRefundProcessor(
        AppDbContext dbContext,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        PaymentNotificationService paymentNotificationService,
        ReportLogWriter reportLogWriter,
        ILogger<OrderRefundProcessor> logger)
    {
        _dbContext = dbContext;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _paymentNotificationService = paymentNotificationService;
        _reportLogWriter = reportLogWriter;
        _logger = logger;
    }

    public async Task<OrderRefundProcessResult> RefundAsync(
        Order order,
        string? requestedByUserId,
        string? reason,
        string source,
        CancellationToken cancellationToken,
        string? idempotencyKeySeed = null,
        long? requestedAmountCents = null,
        Guid? refundRequestId = null)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status503ServiceUnavailable,
                "Stripe is not configured.");
        }

        await _dbContext.Entry(order)
            .Collection(item => item.Payments)
            .Query()
            .Include(payment => payment.Refunds)
            .LoadAsync(cancellationToken);

        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "Only online payments can be refunded through Stripe.");
        }

        if (order.PaymentStatus is not (PaymentStatus.Paid or PaymentStatus.PartiallyRefunded))
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "Only paid online orders can be refunded.",
                $"Payment status is {order.PaymentStatus}.");
        }

        var payment = order.Payments
            .Where(item =>
                item.Provider == PaymentProviders.Stripe &&
                item.Status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded &&
                !string.IsNullOrWhiteSpace(item.ProviderPaymentIntentId))
            .OrderByDescending(item => item.PaidAt ?? item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .FirstOrDefault();

        if (payment is null)
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "No refundable Stripe payment was found for this order.");
        }

        if (payment.ProviderPaymentIntentId!.StartsWith("pi_demo_", StringComparison.OrdinalIgnoreCase))
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "Seeded demo payments cannot be refunded through Stripe.");
        }

        // A refund stuck in Pending — a crash, a timed-out Stripe call, or a dropped webhook — must
        // not block this payment forever, so reconcile it against Stripe before deciding anything.
        var existingPending = payment.Refunds.FirstOrDefault(item => item.Status == PaymentRefundStatus.Pending);
        if (existingPending is not null)
        {
            await AttachRefundRequestAsync(refundRequestId, existingPending, cancellationToken);
            var reconciliation = await ReconcileStuckPendingRefundAsync(
                order,
                payment,
                existingPending,
                cancellationToken);

            if (reconciliation.Outcome == PendingRefundReconciliationOutcome.Succeeded)
            {
                await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);
                await _paymentNotificationService.SendRefundSucceededAsync(
                    order,
                    payment,
                    reconciliation.Refund,
                    ResolveRequesterEmail(order),
                    cancellationToken);
                return OrderRefundProcessResult.Success(reconciliation.Refund);
            }

            if (reconciliation.Outcome == PendingRefundReconciliationOutcome.AwaitingProvider)
            {
                return OrderRefundProcessResult.Failure(
                    reconciliation.StatusCode,
                    "The existing refund is still awaiting confirmation from Stripe.",
                    reconciliation.Detail,
                    reconciliation.Refund);
            }

            existingPending = reconciliation.Outcome == PendingRefundReconciliationOutcome.RetryExisting
                ? reconciliation.Refund
                : null;
        }

        // Still genuinely in flight at Stripe — refuse rather than stack a second refund on top.
        if (existingPending is not null && !string.IsNullOrWhiteSpace(existingPending.ProviderRefundId))
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "A refund is already pending for this payment.");
        }

        var refundedAmountCents = GetSucceededRefundedAmount(payment);
        var refundableAmountCents = payment.AmountCents - refundedAmountCents;
        if (refundableAmountCents <= 0)
        {
            var reconciledAt = DateTime.UtcNow;
            payment.Status = PaymentStatus.Refunded;
            payment.UpdatedAt = reconciledAt;
            order.PaymentStatus = PaymentStatus.Refunded;
            order.UpdatedAt = reconciledAt;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "This payment has already been fully refunded.");
        }

        PaymentRefund refund;
        long refundAmountCents;

        if (existingPending is not null)
        {
            // Orphan: we opened a refund but never learned whether Stripe received it. Retry the
            // SAME row so the SAME idempotency key goes back to Stripe — it either creates the
            // refund once or replays the original, never a second one. The amount must be reused
            // verbatim, because Stripe rejects a reused key carrying different parameters.
            refund = existingPending;
            refundAmountCents = refund.AmountCents;

            if (refundAmountCents > refundableAmountCents)
            {
                return OrderRefundProcessResult.Failure(
                    StatusCodes.Status409Conflict,
                    "The requested refund amount is no longer available.",
                    $"Requested {refundAmountCents} cents; refundable balance is {refundableAmountCents} cents.");
            }

            _logger.LogWarning(
                "Retrying orphaned pending refund {RefundId} for payment {PaymentId}.",
                refund.Id,
                payment.Id);
        }
        else
        {
            refundAmountCents = requestedAmountCents ?? refundableAmountCents;
            if (refundAmountCents <= 0 || refundAmountCents > refundableAmountCents)
            {
                return OrderRefundProcessResult.Failure(
                    StatusCodes.Status409Conflict,
                    "The requested refund amount is no longer available.",
                    $"Requested {refundAmountCents} cents; refundable balance is {refundableAmountCents} cents.");
            }

            var creationResult = await OpenPendingRefundAsync(
                order,
                payment,
                refundAmountCents,
                reason,
                requestedByUserId,
                source,
                cancellationToken);

            if (creationResult.Refund is null)
            {
                return creationResult.Failure!;
            }

            refund = creationResult.Refund;
        }

        await AttachRefundRequestAsync(refundRequestId, refund, cancellationToken);

        try
        {
            var refundOptions = new RefundCreateOptions
            {
                PaymentIntent = payment.ProviderPaymentIntentId,
                Amount = refundAmountCents,
                RefundApplicationFee = payment.PlatformFeeAmountCents > 0,
                Metadata = BuildRefundMetadata(order, payment, refund, reason)
            };
            var requestOptions = new RequestOptions
            {
                IdempotencyKey = idempotencyKeySeed ?? $"order-refund-{refund.Id:N}",
                StripeAccount = payment.StripeAccountId
            };
            var refundService = new RefundService(_stripeClient);
            var stripeRefund = await refundService.CreateAsync(
                refundOptions,
                requestOptions,
                cancellationToken);

            var completedAt = DateTime.UtcNow;
            refund.ProviderRefundId = stripeRefund.Id;
            refund.Status = MapStripeRefundStatus(stripeRefund.Status);
            refund.UpdatedAt = completedAt;

            if (refund.Status == PaymentRefundStatus.Succeeded)
            {
                refund.RefundedAt = completedAt;
            }
            else if (refund.Status == PaymentRefundStatus.Failed)
            {
                refund.FailedAt = completedAt;
                refund.FailureReason = stripeRefund.FailureReason ?? "Stripe marked the refund as failed.";
            }

            ApplyRefundAggregateStatus(order, payment, refund, completedAt);
            await SynchronizeRefundRequestsAsync(refund, completedAt, cancellationToken);

            _reportLogWriter.AddAudit(
                refund.Status == PaymentRefundStatus.Succeeded
                    ? "PaymentRefund.Succeeded"
                    : refund.Status == PaymentRefundStatus.Failed
                        ? "PaymentRefund.Failed"
                        : "PaymentRefund.Pending",
                "PaymentRefund",
                refund.Id.ToString(),
                order.RestaurantId,
                $"Stripe refund {refund.ProviderRefundId ?? refund.Id.ToString()} is {refund.Status}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    refundId = refund.Id,
                    stripeRefundId = refund.ProviderRefundId,
                    refund.Status,
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            _reportLogWriter.AddOrderEvent(
                order,
                "payment.refund_updated",
                $"Refund is {refund.Status} for {order.OrderNumber}.",
                new
                {
                    paymentId = payment.Id,
                    refundId = refund.Id,
                    stripeRefundId = refund.ProviderRefundId,
                    refund.Status,
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            _reportLogWriter.AddPaymentEvent(
                order,
                payment,
                refund,
                "refund.updated",
                refund.ProviderRefundId,
                refund.Status.ToString(),
                $"Stripe refund is {refund.Status}.",
                new
                {
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            await _dbContext.SaveChangesAsync(cancellationToken);

            if (refund.Status == PaymentRefundStatus.Succeeded)
            {
                await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);
                await _paymentNotificationService.SendRefundSucceededAsync(
                    order,
                    payment,
                    refund,
                    ResolveRequesterEmail(order),
                    cancellationToken);
            }
            else if (refund.Status == PaymentRefundStatus.Failed)
            {
                await _paymentNotificationService.SendRefundFailedAsync(
                    order,
                    payment,
                    refund,
                    ResolveRequesterEmail(order),
                    cancellationToken);
            }

            return refund.Status switch
            {
                PaymentRefundStatus.Succeeded => OrderRefundProcessResult.Success(refund),
                PaymentRefundStatus.Pending => OrderRefundProcessResult.Failure(
                    StatusCodes.Status202Accepted,
                    "The refund was submitted and is awaiting confirmation from Stripe.",
                    "The refund request remains Processing until Stripe confirms the outcome.",
                    refund),
                _ => OrderRefundProcessResult.Failure(
                    StatusCodes.Status400BadRequest,
                    "Stripe did not complete the refund.",
                    refund.FailureReason,
                    refund)
            };
        }
        catch (StripeException ex)
        {
            var failureKind = StripeFailureClassifier.Classify(ex.HttpStatusCode, ex.StripeError is not null);

            if (failureKind == StripeFailureKind.Indeterminate)
            {
                // We do not know whether Stripe processed this. Marking it failed would unblock the
                // payment, and the next attempt would mint a fresh idempotency key — which is how a
                // timeout turns into a genuine double refund. Leave it pending instead so the
                // recovery path can re-send the SAME key and let Stripe deduplicate.
                _logger.LogError(
                    ex,
                    "Stripe refund {RefundId} for payment {PaymentId} is indeterminate; leaving it pending for reconciliation.",
                    refund.Id,
                    payment.Id);

                var unknownAt = DateTime.UtcNow;
                refund.FailureReason = $"Unconfirmed with Stripe: {ex.StripeError?.Message ?? ex.Message}";
                refund.UpdatedAt = unknownAt;
                await SynchronizeRefundRequestsAsync(refund, unknownAt, cancellationToken);

                _reportLogWriter.AddAudit(
                    "PaymentRefund.Indeterminate",
                    "PaymentRefund",
                    refund.Id.ToString(),
                    order.RestaurantId,
                    $"Refund outcome unconfirmed with Stripe for {order.OrderNumber}.",
                    after: new
                    {
                        orderId = order.Id,
                        order.OrderNumber,
                        paymentId = payment.Id,
                        refundId = refund.Id,
                        refund.AmountCents,
                        refund.Currency,
                        httpStatusCode = ex.HttpStatusCode,
                        refund.FailureReason,
                        source
                    });
                _reportLogWriter.AddPaymentEvent(
                    order,
                    payment,
                    refund,
                    "refund.indeterminate",
                    refund.ProviderRefundId,
                    refund.Status.ToString(),
                    "Refund outcome could not be confirmed with Stripe.",
                    new { refund.AmountCents, refund.Currency, refund.FailureReason, source });
                await _dbContext.SaveChangesAsync(cancellationToken);

                // Deliberately no customer email: telling someone their refund failed when it may
                // have succeeded is worse than saying nothing until we know.
                return OrderRefundProcessResult.Failure(
                    StatusCodes.Status502BadGateway,
                    "The refund could not be confirmed with Stripe.",
                    "It may still have gone through. The refund stays pending and will be reconciled — do not retry from a different device.",
                    refund);
            }

            _logger.LogWarning(
                ex,
                "Stripe declined the refund for payment {PaymentId} on order {OrderId}.",
                payment.Id,
                order.Id);

            var failedAt = DateTime.UtcNow;
            refund.Status = PaymentRefundStatus.Failed;
            refund.FailureReason = ex.StripeError?.Message ?? ex.Message;
            refund.FailedAt = failedAt;
            refund.UpdatedAt = failedAt;
            await SynchronizeRefundRequestsAsync(refund, failedAt, cancellationToken);
            _reportLogWriter.AddAudit(
                "PaymentRefund.Failed",
                "PaymentRefund",
                refund.Id.ToString(),
                order.RestaurantId,
                $"Stripe refund failed for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    refundId = refund.Id,
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            _reportLogWriter.AddOrderEvent(
                order,
                "payment.refund_failed",
                $"Refund failed for {order.OrderNumber}.",
                new
                {
                    paymentId = payment.Id,
                    refundId = refund.Id,
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            _reportLogWriter.AddPaymentEvent(
                order,
                payment,
                refund,
                "refund.failed",
                refund.ProviderRefundId,
                refund.Status.ToString(),
                "Stripe refund failed.",
                new
                {
                    refund.AmountCents,
                    refund.Currency,
                    refund.FailureReason,
                    source
                });
            await _dbContext.SaveChangesAsync(cancellationToken);
            await _paymentNotificationService.SendRefundFailedAsync(
                order,
                payment,
                refund,
                ResolveRequesterEmail(order),
                cancellationToken);

            return OrderRefundProcessResult.Failure(
                StatusCodes.Status400BadRequest,
                "Failed to create Stripe refund.",
                ex.StripeError?.Message ?? ex.Message,
                refund);
        }
    }

    private static Dictionary<string, string> BuildRefundMetadata(
        Order order,
        Payment payment,
        PaymentRefund refund,
        string? reason)
    {
        var metadata = new Dictionary<string, string>
        {
            [OrderIdMetadataKey] = order.Id.ToString(),
            [PaymentIdMetadataKey] = payment.Id.ToString(),
            [RefundIdMetadataKey] = refund.Id.ToString(),
            ["orderNumber"] = TrimStripeMetadataValue(order.OrderNumber)
        };

        if (!string.IsNullOrWhiteSpace(reason))
        {
            metadata["reason"] = TrimStripeMetadataValue(reason);
        }

        return metadata;
    }

    private static string TrimStripeMetadataValue(string value) =>
        value.Length <= 500 ? value : value[..500];

    private static PaymentRefundStatus MapStripeRefundStatus(string? status) =>
        status?.ToLowerInvariant() switch
        {
            "succeeded" => PaymentRefundStatus.Succeeded,
            "failed" or "canceled" => PaymentRefundStatus.Failed,
            _ => PaymentRefundStatus.Pending
        };

    /// The address the customer used when asking for the refund, when that collection happens to be
    /// loaded. Falls back to null so the notifier can use the account or receipt email instead.
    private static string? ResolveRequesterEmail(Order order) =>
        order.RefundRequests
            .OrderByDescending(request => request.CreatedAt)
            .Select(request => request.RequesterEmail)
            .FirstOrDefault(email => !string.IsNullOrWhiteSpace(email));

    private static long GetSucceededRefundedAmount(Payment payment) =>
        payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

    /// Asks Stripe what really happened to a refund we left Pending. A recovered success is a
    /// terminal result for the current operation: it must be returned to the caller rather than
    /// interpreted as permission to create another refund.
    private async Task<PendingRefundReconciliationResult> ReconcileStuckPendingRefundAsync(
        Order order,
        Payment payment,
        PaymentRefund pendingRefund,
        CancellationToken cancellationToken)
    {
        try
        {
            var refundService = new RefundService(_stripeClient);
            var requestOptions = new RequestOptions { StripeAccount = payment.StripeAccountId };

            Refund? stripeRefund;
            if (string.IsNullOrWhiteSpace(pendingRefund.ProviderRefundId))
            {
                // No id came back, so ask Stripe what actually exists against this payment intent.
                // Every refund we create carries its local id in metadata, which makes the match
                // exact rather than a guess based on amount.
                stripeRefund = await FindRefundByMetadataAsync(
                    refundService,
                    payment,
                    pendingRefund.Id,
                    requestOptions,
                    cancellationToken);

                if (stripeRefund is null)
                {
                    // Stripe genuinely never created it — safe to retry with the same key.
                    return new(PendingRefundReconciliationOutcome.RetryExisting, pendingRefund);
                }

                _logger.LogWarning(
                    "Recovered refund {RefundId} from Stripe as {StripeRefundId} after an unconfirmed attempt.",
                    pendingRefund.Id,
                    stripeRefund.Id);
                pendingRefund.ProviderRefundId = stripeRefund.Id;
            }
            else
            {
                stripeRefund = await refundService.GetAsync(
                    pendingRefund.ProviderRefundId,
                    requestOptions: requestOptions,
                    cancellationToken: cancellationToken);
            }

            var status = MapStripeRefundStatus(stripeRefund.Status);
            if (status == PaymentRefundStatus.Pending)
            {
                var pendingAt = DateTime.UtcNow;
                pendingRefund.UpdatedAt = pendingAt;
                await SynchronizeRefundRequestsAsync(pendingRefund, pendingAt, cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);
                return new(
                    PendingRefundReconciliationOutcome.AwaitingProvider,
                    pendingRefund,
                    StatusCodes.Status409Conflict,
                    "Stripe still reports the original refund as pending; no second refund was created.");
            }

            var reconciledAt = DateTime.UtcNow;
            pendingRefund.Status = status;
            pendingRefund.UpdatedAt = reconciledAt;

            if (status == PaymentRefundStatus.Succeeded)
            {
                pendingRefund.RefundedAt ??= reconciledAt;
            }
            else
            {
                pendingRefund.FailedAt ??= reconciledAt;
                pendingRefund.FailureReason ??= stripeRefund.FailureReason
                    ?? "Stripe reported this refund as no longer pending.";
            }

            ApplyRefundAggregateStatus(order, payment, pendingRefund, reconciledAt);
            await SynchronizeRefundRequestsAsync(pendingRefund, reconciledAt, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
            _logger.LogInformation(
                "Reconciled stuck pending refund {RefundId} to {Status} from Stripe.",
                pendingRefund.Id,
                status);

            return new(
                status == PaymentRefundStatus.Succeeded
                    ? PendingRefundReconciliationOutcome.Succeeded
                    : PendingRefundReconciliationOutcome.Failed,
                pendingRefund);
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(
                ex,
                "Could not reconcile pending refund {RefundId} with Stripe; leaving it pending.",
                pendingRefund.Id);
            var indeterminateAt = DateTime.UtcNow;
            pendingRefund.FailureReason = $"Unconfirmed with Stripe: {ex.StripeError?.Message ?? ex.Message}";
            pendingRefund.UpdatedAt = indeterminateAt;
            await SynchronizeRefundRequestsAsync(pendingRefund, indeterminateAt, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return new(
                PendingRefundReconciliationOutcome.AwaitingProvider,
                pendingRefund,
                StatusCodes.Status502BadGateway,
                "Stripe could not confirm the original refund. Its local record remains pending and no second refund was created.");
        }
    }

    private async Task AttachRefundRequestAsync(
        Guid? refundRequestId,
        PaymentRefund refund,
        CancellationToken cancellationToken)
    {
        if (!refundRequestId.HasValue)
        {
            return;
        }

        var refundRequest = await _dbContext.PaymentRefundRequests
            .FirstOrDefaultAsync(request => request.Id == refundRequestId.Value, cancellationToken);
        if (refundRequest is null)
        {
            return;
        }

        refundRequest.Status = PaymentRefundRequestStatus.Processing;
        refundRequest.PaymentRefundId = refund.Id;
        refundRequest.UpdatedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task SynchronizeRefundRequestsAsync(
        PaymentRefund refund,
        DateTime updatedAt,
        CancellationToken cancellationToken)
    {
        var refundRequests = await _dbContext.PaymentRefundRequests
            .Where(request => request.PaymentRefundId == refund.Id)
            .ToListAsync(cancellationToken);

        foreach (var refundRequest in refundRequests)
        {
            if (refund.Status == PaymentRefundStatus.Succeeded)
            {
                refundRequest.Status = PaymentRefundRequestStatus.Approved;
                refundRequest.ReviewedAt ??= updatedAt;
            }
            else if (refund.Status == PaymentRefundStatus.Failed)
            {
                refundRequest.Status = PaymentRefundRequestStatus.Pending;
                refundRequest.PaymentRefundId = null;
            }
            else
            {
                refundRequest.Status = PaymentRefundRequestStatus.Processing;
            }

            refundRequest.UpdatedAt = updatedAt;
        }
    }

    private static void ApplyRefundAggregateStatus(
        Order order,
        Payment payment,
        PaymentRefund refund,
        DateTime updatedAt)
    {
        if (refund.Status != PaymentRefundStatus.Succeeded)
        {
            return;
        }

        var refundedAmountCents = GetSucceededRefundedAmount(payment);
        payment.Status = refundedAmountCents >= payment.AmountCents
            ? PaymentStatus.Refunded
            : PaymentStatus.PartiallyRefunded;
        payment.UpdatedAt = updatedAt;
        order.PaymentStatus = payment.Status;
        order.UpdatedAt = updatedAt;
    }

    /// Looks for a refund Stripe may have created during an attempt whose response we never saw.
    /// Matched on the local refund id we stamp into metadata, so an unrelated refund of the same
    /// amount can never be mistaken for ours.
    private static async Task<Refund?> FindRefundByMetadataAsync(
        RefundService refundService,
        Payment payment,
        Guid localRefundId,
        RequestOptions requestOptions,
        CancellationToken cancellationToken)
    {
        var candidates = await refundService.ListAsync(
            new RefundListOptions
            {
                PaymentIntent = payment.ProviderPaymentIntentId,
                Limit = 100
            },
            requestOptions,
            cancellationToken);

        return candidates.FirstOrDefault(candidate =>
            candidate.Metadata is not null
            && candidate.Metadata.TryGetValue(RefundIdMetadataKey, out var metadataRefundId)
            && string.Equals(metadataRefundId, localRefundId.ToString(), StringComparison.OrdinalIgnoreCase));
    }

    /// Opens the Pending refund row inside a short transaction that locks the payment, so the
    /// balance cannot shift underneath us. The unique index is the real guarantee — if a
    /// concurrent attempt wins the race, our insert violates it and we surrender.
    private async Task<(PaymentRefund? Refund, OrderRefundProcessResult? Failure)> OpenPendingRefundAsync(
        Order order,
        Payment payment,
        long refundAmountCents,
        string? reason,
        string? requestedByUserId,
        string source,
        CancellationToken cancellationToken)
    {
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        _ = await _dbContext.Payments
            .FromSql($"SELECT * FROM \"Payments\" WHERE \"Id\" = {payment.Id} FOR UPDATE")
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var refund = new PaymentRefund
        {
            Id = Guid.NewGuid(),
            PaymentId = payment.Id,
            Payment = payment,
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            ProviderPaymentIntentId = payment.ProviderPaymentIntentId,
            AmountCents = refundAmountCents,
            Currency = payment.Currency,
            Status = PaymentRefundStatus.Pending,
            Reason = reason,
            RequestedByUserId = requestedByUserId,
            CreatedAt = now
        };
        _dbContext.PaymentRefunds.Add(refund);
        _reportLogWriter.AddAudit(
            "PaymentRefund.CreateRequested",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Refund requested for {order.OrderNumber}.",
            after: new
            {
                orderId = order.Id,
                order.OrderNumber,
                paymentId = payment.Id,
                refundId = refund.Id,
                amountCents = refundAmountCents,
                payment.Currency,
                reason,
                source
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "payment.refund_requested",
            $"Refund requested for {order.OrderNumber}.",
            new
            {
                paymentId = payment.Id,
                refundId = refund.Id,
                amountCents = refundAmountCents,
                payment.Currency,
                reason,
                source
            });
        _reportLogWriter.AddPaymentEvent(
            order,
            payment,
            refund,
            "refund.requested",
            null,
            refund.Status.ToString(),
            $"Refund requested for payment {payment.Id}.",
            new
            {
                amountCents = refundAmountCents,
                payment.Currency,
                reason,
                source
            });

        try
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (refund, null);
        }
        catch (DbUpdateException ex) when (IsPendingRefundConflict(ex))
        {
            await transaction.RollbackAsync(cancellationToken);
            _dbContext.Entry(refund).State = EntityState.Detached;
            payment.Refunds.Remove(refund);

            _logger.LogWarning(
                "Concurrent refund attempt rejected for payment {PaymentId}.",
                payment.Id);

            return (null, OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "A refund is already pending for this payment."));
        }
    }

    private static bool IsPendingRefundConflict(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "UX_PaymentRefunds_OnePendingPerPayment"
        };
}

public sealed class OrderRefundProcessResult
{
    private OrderRefundProcessResult(
        bool isSuccess,
        int statusCode,
        string message,
        string? detail,
        PaymentRefund? refund)
    {
        IsSuccess = isSuccess;
        StatusCode = statusCode;
        Message = message;
        Detail = detail;
        Refund = refund;
    }

    public bool IsSuccess { get; }

    public int StatusCode { get; }

    public string Message { get; }

    public string? Detail { get; }

    public PaymentRefund? Refund { get; }

    public static OrderRefundProcessResult Success(PaymentRefund refund) =>
        new(true, StatusCodes.Status200OK, "Refund created.", null, refund);

    public static OrderRefundProcessResult Failure(
        int statusCode,
        string message,
        string? detail = null,
        PaymentRefund? refund = null) =>
        new(false, statusCode, message, detail, refund);
}
