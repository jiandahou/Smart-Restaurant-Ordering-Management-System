namespace DineFlow.Infrastructure.Menu;

public enum OptionAdjustmentType
{
    Add,
    Remove,
    Replace
}

public class MenuItemOption
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid GroupId { get; set; }

    public Guid MenuItemId { get; set; }

    public Guid RestaurantId { get; set; }

    public string Name { get; set; } = string.Empty;

    public decimal PriceAdjustment { get; set; } = 0;

    public OptionAdjustmentType AdjustmentType { get; set; } = OptionAdjustmentType.Add;

    public int DisplayOrder { get; set; }

    public bool IsAvailable { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public MenuItemOptionGroup? Group { get; set; }
}
