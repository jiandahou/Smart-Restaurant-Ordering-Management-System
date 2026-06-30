namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundResponse
{
    public Guid Id { get; set; }

    public Guid PaymentId { get; set; }

    public Guid OrderId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string Provider { get; set; } = string.Empty;

    public string? ProviderRefundId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public long AmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public string? FailureReason { get; set; }

    public string? RequestedByUserId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? RefundedAt { get; set; }

    public DateTime? FailedAt { get; set; }
}
