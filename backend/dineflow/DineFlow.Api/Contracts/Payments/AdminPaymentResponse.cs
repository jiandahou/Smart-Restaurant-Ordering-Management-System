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
