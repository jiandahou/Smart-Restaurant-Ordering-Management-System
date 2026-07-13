using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Restaurant;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Infrastructure.Carts;

public class Cart
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public Guid? TableSessionId { get; set; }

    public Guid? OrderId { get; set; }

    public OrderType OrderType { get; set; } = OrderType.Takeaway;

    public CartStatus Status { get; set; } = CartStatus.Active;

    public string? CustomerNote { get; set; }

    public DateTime ExpiresAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public RestaurantEntity? Restaurant { get; set; }

    public RestaurantTable? Table { get; set; }

    public TableSession? TableSession { get; set; }

    public Order? Order { get; set; }

    public ICollection<CartItem> Items { get; set; } = [];

    public ICollection<CartParticipant> Participants { get; set; } = [];
}
