using DineFlow.Infrastructure.Orders;

namespace DineFlow.Infrastructure.Payments;

public class Payment
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public string Provider { get; set; } = PaymentProviders.Stripe;

    public string? ProviderCheckoutSessionId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string? StripeAccountId { get; set; }

    public string? CheckoutUrl { get; set; }

    public string? IdempotencyKey { get; set; }

    public long PlatformFeeAmountCents { get; set; }

    public DateTime? LastProviderEventCreatedAt { get; set; }

    public long AmountCents { get; set; }

    public string Currency { get; set; } = "aud";

    public PaymentStatus Status { get; set; } = PaymentStatus.Pending;

    public string? FailureReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }

    public DateTime? FailedAt { get; set; }

    public string? RecordedByUserId { get; set; }

    public ICollection<PaymentRefund> Refunds { get; set; } = [];

    public ICollection<PaymentRefundRequest> RefundRequests { get; set; } = [];

    public Order? Order { get; set; }
}

public class PaymentRefund
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid PaymentId { get; set; }

    public Guid OrderId { get; set; }

    public string Provider { get; set; } = PaymentProviders.Stripe;

    public string? ProviderRefundId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public long AmountCents { get; set; }

    public string Currency { get; set; } = "aud";

    public PaymentRefundStatus Status { get; set; } = PaymentRefundStatus.Pending;

    public string? Reason { get; set; }

    public string? FailureReason { get; set; }

    public string? RequestedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public DateTime? RefundedAt { get; set; }

    public DateTime? FailedAt { get; set; }

    public Payment? Payment { get; set; }
}

public class PaymentRefundRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public Guid PaymentId { get; set; }

    public Guid? PaymentRefundId { get; set; }

    public Guid? RestaurantId { get; set; }

    public PaymentRefundRequestStatus Status { get; set; } = PaymentRefundRequestStatus.Pending;

    public long RequestedAmountCents { get; set; }

    public string Currency { get; set; } = "aud";

    public string? Reason { get; set; }

    public string? AdminNote { get; set; }

    public string? RequestedByUserId { get; set; }

    public string? RequesterName { get; set; }

    public string? RequesterEmail { get; set; }

    public string? ReviewedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public Order? Order { get; set; }

    public Payment? Payment { get; set; }

    public PaymentRefund? PaymentRefund { get; set; }
}

public enum PaymentStatus
{
    Pending = 0,
    Paid = 1,
    Failed = 2,
    Cancelled = 3,
    Expired = 4,
    Refunded = 5,
    PartiallyRefunded = 6,
    NotRequired = 7,
    Unpaid = 8
}

public enum PaymentRefundStatus
{
    Pending = 0,
    Succeeded = 1,
    Failed = 2
}

public enum PaymentRefundRequestStatus
{
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Cancelled = 3,
    Processing = 4
}

public class StripeWebhookEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string EventId { get; set; } = string.Empty;

    public string? StripeAccountId { get; set; }

    public string EventType { get; set; } = string.Empty;

    public DateTime ProviderCreatedAt { get; set; }

    public DateTime ProcessedAt { get; set; } = DateTime.UtcNow;
}

public enum PaymentMethod
{
    Online = 0,
    PayAtCounter = 1
}

public static class PaymentProviders
{
    public const string Stripe = "Stripe";
    public const string Counter = "Counter";
    public const string CounterCash = "CounterCash";
    public const string CounterCard = "CounterCard";
}
