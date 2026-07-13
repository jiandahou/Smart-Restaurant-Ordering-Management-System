namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string PaymentPolicy { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public bool AcceptingOrders { get; set; }

    public string OpeningHoursJson { get; set; } = string.Empty;

    public string SpecialOpeningDaysJson { get; set; } = "[]";

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }
}
