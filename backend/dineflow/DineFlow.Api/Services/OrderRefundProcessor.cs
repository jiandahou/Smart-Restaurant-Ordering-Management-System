using DineFlow.Api.Options;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
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
    private readonly ReportLogWriter _reportLogWriter;
    private readonly ILogger<OrderRefundProcessor> _logger;

    public OrderRefundProcessor(
        AppDbContext dbContext,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        ReportLogWriter reportLogWriter,
        ILogger<OrderRefundProcessor> logger)
    {
        _dbContext = dbContext;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
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
        long? requestedAmountCents = null)
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

        if (payment.Refunds.Any(refund => refund.Status == PaymentRefundStatus.Pending))
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

        var refundAmountCents = requestedAmountCents ?? refundableAmountCents;
        if (refundAmountCents <= 0 || refundAmountCents > refundableAmountCents)
        {
            return OrderRefundProcessResult.Failure(
                StatusCodes.Status409Conflict,
                "The requested refund amount is no longer available.",
                $"Requested {refundAmountCents} cents; refundable balance is {refundableAmountCents} cents.");
        }

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
        await _dbContext.SaveChangesAsync(cancellationToken);

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
                var totalRefundedAfter = refundedAmountCents + refundAmountCents;
                payment.Status = totalRefundedAfter >= payment.AmountCents
                    ? PaymentStatus.Refunded
                    : PaymentStatus.PartiallyRefunded;
                payment.UpdatedAt = completedAt;
                order.PaymentStatus = payment.Status;
                order.UpdatedAt = completedAt;
            }
            else if (refund.Status == PaymentRefundStatus.Failed)
            {
                refund.FailedAt = completedAt;
                refund.FailureReason = stripeRefund.FailureReason ?? "Stripe marked the refund as failed.";
            }

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
            }

            return OrderRefundProcessResult.Success(refund);
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(
                ex,
                "Stripe failed to refund payment {PaymentId} for order {OrderId}.",
                payment.Id,
                order.Id);

            var failedAt = DateTime.UtcNow;
            refund.Status = PaymentRefundStatus.Failed;
            refund.FailureReason = ex.StripeError?.Message ?? ex.Message;
            refund.FailedAt = failedAt;
            refund.UpdatedAt = failedAt;
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

    private static long GetSucceededRefundedAmount(Payment payment) =>
        payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);
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
