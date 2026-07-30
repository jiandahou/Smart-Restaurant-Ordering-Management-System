namespace DineFlow.Api.Contracts.Menu;

public class UpdateMenuItemsStateRequest
{
    public Guid RestaurantId { get; set; }
    public List<Guid> ItemIds { get; set; } = [];
    public bool IsAvailable { get; set; }
    public bool IsSoldOut { get; set; }
}
