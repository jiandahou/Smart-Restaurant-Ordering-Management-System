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
    public int DisplayOrder { get; set; }
}
