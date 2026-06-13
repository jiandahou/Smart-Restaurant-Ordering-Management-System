namespace DineFlow.Api.Contracts.Restaurant;

public class UpdateRestaurantTableRequest
{
    public string TableNumber { get; set; } = string.Empty;

    public int Capacity { get; set; }

    public bool IsActive { get; set; } = true;
}
