using DineFlow.Infrastructure.Identity;

namespace DineFlow.Infrastructure.Orders;

public class OrderStatusHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public OrderStatus PreviousStatus { get; set; }

    public OrderStatus NewStatus { get; set; }

    public string? ChangedByUserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Order? Order { get; set; }

    public ApplicationUser? ChangedByUser { get; set; }
}
