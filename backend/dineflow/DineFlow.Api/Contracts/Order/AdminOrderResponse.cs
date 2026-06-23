namespace DineFlow.Api.Contracts.Order;

public sealed class AdminOrderResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string Currency { get; set; } = string.Empty;

    public Guid? TableId { get; set; }

    public string? TableNumber { get; set; }

    public string? CustomerId { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public string OrderType { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string PaymentStatus { get; set; } = string.Empty;

    public string PaymentMethod { get; set; } = string.Empty;

    public bool CanProcess { get; set; }

    public List<string> AvailableActions { get; set; } = [];

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public int PaymentAttempts { get; set; }

    public AdminOrderPaymentResponse? LatestPayment { get; set; }

    public List<AdminOrderItemResponse> Items { get; set; } = [];
}

public sealed class AdminOrderItemResponse
{
    public Guid Id { get; set; }

    public Guid? MenuItemId { get; set; }

    public string ItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal TotalPrice { get; set; }

    public string? Note { get; set; }
}

public sealed class AdminOrderPaymentResponse
{
    public Guid Id { get; set; }

    public string Provider { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public long AmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? ProviderCheckoutSessionId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string? FailureReason { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }

    public DateTime? FailedAt { get; set; }
}
