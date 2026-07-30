namespace DineFlow.Api.Contracts.Menu;

public class CreateMenuItemRequest
{
    public Guid RestaurantId { get; set; }
    public Guid CategoryId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? ImageUrl { get; set; }
    public bool IsAvailable { get; set; } = true;
    public bool IsSoldOut { get; set; }
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
}
