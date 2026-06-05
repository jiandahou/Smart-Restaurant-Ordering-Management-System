namespace DineFlow.Api.Contracts.Order;

public class CreateOrderRequest
{
    public Guid? RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public Guid? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public int OrderType { get; set; }

    public int Status { get; set; }

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public List<CreateOrderItemRequest> OrderItems { get; set; } = new();
}

public class CreateOrderItemRequest
{
    public Guid? MenuItemId { get; set; }

    public int Quantity { get; set; } = 1;

    public decimal UnitPrice { get; set; }

    public string? Note { get; set; }
}
