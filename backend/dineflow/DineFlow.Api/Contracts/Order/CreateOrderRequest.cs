namespace DineFlow.Api.Contracts.Order;

public class CreateOrderRequest
{
    public Guid RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public string? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public int OrderType { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public List<CreateOrderItemRequest> Items { get; set; } = new();
}

public class CreateOrderItemRequest
{
    public Guid MenuItemId { get; set; }

    public string? ItemNameSnapshot { get; set; }

    public int Quantity { get; set; } = 1;

    public List<Guid> SelectedOptionIds { get; set; } = new();

    public string? ItemInstructions { get; set; }

    public string? AllergyInfo { get; set; }
}

public class UpdateOrderStatusRequest
{
    public int NewStatus { get; set; }
}
