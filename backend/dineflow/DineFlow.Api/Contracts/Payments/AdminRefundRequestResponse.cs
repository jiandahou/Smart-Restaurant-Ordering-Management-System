namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundRequestResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid PaymentId { get; set; }

    public Guid? PaymentRefundId { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string Status { get; set; } = string.Empty;

    public long RequestedAmountCents { get; set; }

    public long OriginalPaymentAmountCents { get; set; }

    public long AlreadyRefundedAmountCents { get; set; }

    public long RefundableAmountCents { get; set; }

    public int PreviousRefundCount { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public string? AdminNote { get; set; }

    public string? RequestedByUserId { get; set; }

    public string? ReviewedByUserId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public List<AdminRefundRequestItemResponse> Items { get; set; } = [];
}

public sealed class AdminRefundRequestItemResponse
{
    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public long AmountCents { get; set; }
}
