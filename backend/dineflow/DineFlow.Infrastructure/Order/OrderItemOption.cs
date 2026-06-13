namespace DineFlow.Infrastructure.Orders;

public class OrderItemOption
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderItemId { get; set; }

    // Nullable — original option may be archived/deleted
    public Guid? MenuItemOptionId { get; set; }

    // Immutable snapshots
    public string GroupNameSnapshot { get; set; } = string.Empty;

    public string OptionNameSnapshot { get; set; } = string.Empty;

    public decimal PriceAdjustmentSnapshot { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public OrderItem? OrderItem { get; set; }
}
