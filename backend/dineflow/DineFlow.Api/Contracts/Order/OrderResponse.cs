namespace DineFlow.Api.Contracts.Order;

public class OrderResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public string? TableNumber { get; set; }

    public string? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public DateOnly? PickupDate { get; set; }

    public int? PickupNumber { get; set; }

    public string PickupCode { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public int OrderType { get; set; }

    public int Status { get; set; }

    public string PaymentStatus { get; set; } = string.Empty;

    public string PaymentMethod { get; set; } = string.Empty;

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public CustomerRefundRequestResponse? LatestRefundRequest { get; set; }

    public OrderRefundBalance RefundBalance { get; set; } = new();

    public List<OrderItemResponse> OrderItems { get; set; } = new();
}

public class OrderRefundBalance
{
    /// Total already refunded against this order's payment (succeeded refunds only).
    public long AlreadyRefundedAmountCents { get; set; }

    /// What is still available to refund. Zero when there is no refundable online payment.
    public long RefundableAmountCents { get; set; }

    /// Refunded money that could NOT be tied to specific items — direct refunds and adjusted
    /// multi-item approvals. Surfaced separately so we never imply a wrong item was refunded.
    public long UnattributedRefundedAmountCents { get; set; }
}

public class OrderItemResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid? MenuItemId { get; set; }

    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public decimal BasePriceSnapshot { get; set; }

    public string ItemNameSnapshot { get; set; } = string.Empty;

    /// Current menu image for this item, when the menu item still exists.
    /// Not snapshotted — purely presentational, so it may be null for deleted menu items.
    public string? ImageUrl { get; set; }

    public int Quantity { get; set; }

    /// Units of this line already refunded, counted only from refunds we can attribute exactly
    /// to this item. Partial unit refunds are reflected in the amount fields below.
    public int RefundedQuantity { get; set; }

    /// Money already refunded and unambiguously attributed to this order line.
    public long RefundedAmountCents { get; set; }

    /// Money that can still be requested against this line before applying the order-wide cap.
    public long RefundableAmountCents { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal TotalPrice => Quantity * UnitPrice;

    public string? ItemInstructions { get; set; }

    public string? Note { get; set; }

    public string? AllergyInfo { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public List<OrderItemOptionResponse> SelectedOptions { get; set; } = new();
}

public class OrderItemOptionResponse
{
    public Guid Id { get; set; }

    public Guid? MenuItemOptionId { get; set; }

    public string GroupNameSnapshot { get; set; } = string.Empty;

    public string OptionNameSnapshot { get; set; } = string.Empty;

    public decimal PriceAdjustmentSnapshot { get; set; }

    public int Quantity { get; set; } = 1;
}

public sealed class GuestOrderLookupRequest
{
    /// Legacy shape, kept so orders saved before guest tokens existed can still be looked up.
    public List<Guid> OrderIds { get; set; } = new();

    /// Preferred shape: each order paired with the token issued when it was placed.
    public List<GuestOrderLookupEntry> Orders { get; set; } = new();
}

public sealed class GuestOrderLookupEntry
{
    public Guid OrderId { get; set; }

    public string? GuestAccessToken { get; set; }
}
