namespace DineFlow.Api.Contracts.Order;

public class OrderResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public string? TableNumber { get; set; }

    public string? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public int OrderType { get; set; }

    public int Status { get; set; }

    public string PaymentStatus { get; set; } = string.Empty;

    public string PaymentMethod { get; set; } = string.Empty;

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public List<OrderItemResponse> OrderItems { get; set; } = new();
}

public class OrderItemResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid? MenuItemId { get; set; }

    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public decimal BasePriceSnapshot { get; set; }

    public string ItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

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
}
