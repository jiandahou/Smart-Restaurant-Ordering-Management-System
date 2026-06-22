using DineFlow.Infrastructure.Orders;

namespace DineFlow.Infrastructure.Payments;

public class Payment
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public string Provider { get; set; } = PaymentProviders.Stripe;

    public string? ProviderCheckoutSessionId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public long AmountCents { get; set; }

    public string Currency { get; set; } = "aud";

    public PaymentStatus Status { get; set; } = PaymentStatus.Pending;

    public string? FailureReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }

    public DateTime? FailedAt { get; set; }

    public string? RecordedByUserId { get; set; }

    public Order? Order { get; set; }
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

public enum PaymentMethod
{
    Online = 0,
    PayAtCounter = 1
}

public static class PaymentProviders
{
    public const string Stripe = "Stripe";
    public const string Counter = "Counter";
}
