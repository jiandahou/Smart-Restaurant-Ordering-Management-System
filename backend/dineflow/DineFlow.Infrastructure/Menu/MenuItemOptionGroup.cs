namespace DineFlow.Infrastructure.Menu;

public class MenuItemOptionGroup
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid MenuItemId { get; set; }

    public Guid RestaurantId { get; set; }

    public string Name { get; set; } = string.Empty;

    public bool IsRequired { get; set; } = false;

    public int MinSelections { get; set; } = 0;

    public int MaxSelections { get; set; } = 1;

    public int DisplayOrder { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public MenuItem? MenuItem { get; set; }

    public ICollection<MenuItemOption> Options { get; set; } = [];
}
