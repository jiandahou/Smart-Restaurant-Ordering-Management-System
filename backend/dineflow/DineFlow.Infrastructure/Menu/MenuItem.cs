using System;

namespace DineFlow.Infrastructure.Menu;

public class MenuItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public Guid CategoryId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public decimal Price { get; set; }

    public string? ImageUrl { get; set; }

    public bool IsAvailable { get; set; } = true;

    public bool IsSoldOut { get; set; } = false;

    public bool IsVegetarian { get; set; } = false;

    public bool IsVegan { get; set; } = false;

    public bool IsGlutenFree { get; set; } = false;

    public bool IsHalal { get; set; } = false;

    public string? Allergens { get; set; }

    public int DisplayOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public MenuCategory? Category { get; set; }

    public ICollection<MenuItemOptionGroup> OptionGroups { get; set; } = [];
}
