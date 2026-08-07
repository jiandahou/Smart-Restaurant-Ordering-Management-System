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

    /// The charge behind the payment intent. Needed for Stripe dashboard deep links and for
    /// resolving the balance transaction that carries Stripe's own processing fee.
    public string? ProviderChargeId { get; set; }

    /// Stripe's processing fee, read from the charge's balance transaction. Null until synced —
    /// it does not exist until the charge settles.
    public long? StripeFeeAmountCents { get; set; }

    /// What actually lands in the connected account: amount minus Stripe's fee minus our platform
    /// fee. Stored as reported by Stripe rather than recomputed, so it always reconciles.
    public long? NetAmountCents { get; set; }

    /// Stripe's hosted receipt page for the charge. Populated on sync.
    public string? ProviderReceiptUrl { get; set; }

    /// Where Stripe sent the receipt. Guest checkouts never store an email on the order, so this
    /// is often the only address we can reach the payer on.
    public string? ReceiptEmail { get; set; }

    /// Latest dispute state seen for this payment, e.g. "needs_response" / "won" / "lost".
    public string? DisputeStatus { get; set; }

    public string? DisputeReason { get; set; }

    public DateTime? DisputedAt { get; set; }

    /// Stripe's dispute id, needed to link straight to the dispute rather than the payment.
    public string? DisputeId { get; set; }

    /// Disputes can be raised for less than the full payment.
    public long? DisputeAmountCents { get; set; }

    /// Miss this deadline and Stripe closes the dispute against the restaurant automatically, so
    /// it is the single most operationally urgent thing about a dispute.
    public DateTime? DisputeEvidenceDueBy { get; set; }

    /// Disputes get their own provider event clock: webhook ordering is not guaranteed and a stale
    /// dispute.updated must not reopen one that has already closed.
    public DateTime? LastDisputeEventCreatedAt { get; set; }

    /// When an operator (or the system) last pulled the truth from Stripe, as opposed to
    /// LastProviderEventCreatedAt which tracks the newest webhook applied.
    public DateTime? LastSyncedAt { get; set; }

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

    /// How the counter took the money — "Cash", "Card", or null for online/unspecified. Previously
    /// this only existed inside audit-log JSON, so cash movements could not be reconciled at all.
    public string? TenderType { get; set; }

    /// Cash handed over and change given back. Null for card and online payments.
    public long? AmountReceivedCents { get; set; }

    public long? ChangeDueCents { get; set; }

    /// Set when a counter payment is reversed outright because it should never have been taken,
    /// as opposed to a refund, which returns money on a payment that was legitimately collected.
    public DateTime? VoidedAt { get; set; }

    public string? VoidedByUserId { get; set; }

    public string? VoidReason { get; set; }

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

    /// Stripe does not guarantee webhook ordering, so we track the provider event time this row
    /// was last reconciled from and ignore anything older.
    public DateTime? LastProviderEventCreatedAt { get; set; }

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

    public ICollection<PaymentRefundRequestItem> Items { get; set; } = [];
}

public class PaymentRefundRequestItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid PaymentRefundRequestId { get; set; }

    public Guid OrderItemId { get; set; }

    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public long AmountCents { get; set; }

    public PaymentRefundRequest? PaymentRefundRequest { get; set; }
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
