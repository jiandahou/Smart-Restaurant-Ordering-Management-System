namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminPaymentResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string OrderStatus { get; set; } = string.Empty;

    public string OrderType { get; set; } = string.Empty;

    public string Provider { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public long AmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? ProviderCheckoutSessionId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string? ProviderChargeId { get; set; }

    public string? StripeAccountId { get; set; }

    public long PlatformFeeAmountCents { get; set; }

    /// Null until the payment has been synced — Stripe's fee only exists once the charge settles.
    public long? StripeFeeAmountCents { get; set; }

    public long? NetAmountCents { get; set; }

    public string? ProviderReceiptUrl { get; set; }

    public string? ReceiptEmail { get; set; }

    public string? DisputeId { get; set; }

    public string? DisputeStatus { get; set; }

    public long? DisputeAmountCents { get; set; }

    /// Missing this deadline loses the dispute automatically.
    public DateTime? DisputeEvidenceDueBy { get; set; }

    public string? DisputeReason { get; set; }

    public DateTime? DisputedAt { get; set; }

    /// Newest Stripe webhook applied to this payment.
    public DateTime? LastProviderEventCreatedAt { get; set; }

    /// Last manual/explicit pull of the truth from Stripe.
    public DateTime? LastSyncedAt { get; set; }

    public string? FailureReason { get; set; }

    public int RefundCount { get; set; }

    public long RefundedAmountCents { get; set; }

    public long RefundableAmountCents { get; set; }

    public bool HasPendingRefund { get; set; }

    public List<AdminPaymentRefundResponse> Refunds { get; set; } = [];

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }

    public DateTime? FailedAt { get; set; }
}
