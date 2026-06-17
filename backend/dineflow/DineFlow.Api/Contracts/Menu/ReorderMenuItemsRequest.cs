namespace DineFlow.Api.Contracts.Menu;

public class ReorderMenuItemsRequest
{
    public Guid CategoryId { get; set; }
    public List<Guid> ItemIds { get; set; } = [];
}
