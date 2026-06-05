namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantRequest
{
    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}
