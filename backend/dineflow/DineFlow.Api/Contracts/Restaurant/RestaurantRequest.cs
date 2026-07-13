namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantRequest
{
    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = "AU";

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string PaymentPolicy { get; set; } = "PayAtCounterAllowed";

    public bool IsActive { get; set; } = true;

    public bool AcceptingOrders { get; set; } = true;

    public string? OpeningHoursJson { get; set; }

    public string? SpecialOpeningDaysJson { get; set; }
}

public class RestaurantOrderingStatusRequest
{
    public bool AcceptingOrders { get; set; }
}
