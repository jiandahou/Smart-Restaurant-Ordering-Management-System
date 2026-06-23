namespace DineFlow.Infrastructure.Orders;

public class OrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public Guid? MenuItemId { get; set; }

    // Immutable snapshots — preserved even if menu changes later
    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public decimal BasePriceSnapshot { get; set; }

    public int Quantity { get; set; } = 1;

    // Calculated server-side: BasePriceSnapshot + sum of option price adjustments
    public decimal UnitPrice { get; set; }

    public decimal TotalPrice => Quantity * UnitPrice;

    public string? ItemInstructions { get; set; }

    public string? AllergyInfo { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public Order? Order { get; set; }

    public ICollection<OrderItemOption> SelectedOptions { get; set; } = [];
}
