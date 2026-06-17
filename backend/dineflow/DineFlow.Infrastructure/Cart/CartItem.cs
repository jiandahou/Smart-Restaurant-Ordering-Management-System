using DineFlow.Infrastructure.Menu;

namespace DineFlow.Infrastructure.Carts;

public class CartItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CartId { get; set; }

    public Guid MenuItemId { get; set; }

    public int Quantity { get; set; } = 1;

    public string? Note { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public Cart? Cart { get; set; }

    public MenuItem? MenuItem { get; set; }
}
