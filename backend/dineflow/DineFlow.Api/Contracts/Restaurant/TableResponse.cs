namespace DineFlow.Api.Contracts.Restaurant;

public class TableResponse
{
    public Guid Id { get; set; }
    public Guid RestaurantId { get; set; }
    public string TableNumber { get; set; } = string.Empty;
    public int Capacity { get; set; }
    public bool IsActive { get; set; }
}
