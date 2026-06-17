namespace DineFlow.Api.Contracts.Menu;

public class ReorderMenuCategoriesRequest
{
    public Guid RestaurantId { get; set; }
    public List<Guid> CategoryIds { get; set; } = [];
}
