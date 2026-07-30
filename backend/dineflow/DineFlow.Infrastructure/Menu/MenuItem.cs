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

    /// <summary>
    /// Pins the item to the dashboard's watch list so staff can flip its availability without
    /// hunting through the full menu. Restaurant-wide, not per user.
    /// </summary>
    public bool IsWatched { get; set; } = false;

    /// <summary>
    /// Remaining portions. Null means untracked / unlimited, which is the case for most items —
    /// stock is opt-in per item. Reaching zero marks the item sold out.
    /// </summary>
    public int? StockQuantity { get; set; }

    public bool IsVegetarian { get; set; } = false;

    public bool IsVegan { get; set; } = false;

    public bool IsGlutenFree { get; set; } = false;

    public bool IsHalal { get; set; } = false;

    public string? Allergens { get; set; }

    /// <summary>Customer-facing heat level: 0 none, 1 mild, 2 medium, 3 hot.</summary>
    public int SpiceLevel { get; set; }

    /// <summary>Free-form serving guidance, for example "Serves 2" or "350 ml".</summary>
    public string? ServingSize { get; set; }

    public int? Calories { get; set; }

    public bool IsPopular { get; set; }

    public bool IsRecommended { get; set; }

    public int DisplayOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public MenuCategory? Category { get; set; }

    public ICollection<MenuItemOptionGroup> OptionGroups { get; set; } = [];
}
