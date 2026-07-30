namespace DineFlow.Api.Contracts.Menu;

public class MenuItemResponse
{
    public Guid Id { get; set; }
    public Guid RestaurantId { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? ImageUrl { get; set; }
    public bool IsAvailable { get; set; }
    public bool IsSoldOut { get; set; }
    /// <summary>Pinned to the dashboard watch list for quick availability changes.</summary>
    public bool IsWatched { get; set; }
    /// <summary>Remaining portions, or null when the item is untracked / unlimited.</summary>
    public int? StockQuantity { get; set; }
    public bool IsVegetarian { get; set; }
    public bool IsVegan { get; set; }
    public bool IsGlutenFree { get; set; }
    public bool IsHalal { get; set; }
    public string? Allergens { get; set; }
    public int SpiceLevel { get; set; }
    public string? ServingSize { get; set; }
    public int? Calories { get; set; }
    public bool IsPopular { get; set; }
    public bool IsRecommended { get; set; }
    public int DisplayOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public List<MenuOptionGroupResponse> OptionGroups { get; set; } = new();
}
