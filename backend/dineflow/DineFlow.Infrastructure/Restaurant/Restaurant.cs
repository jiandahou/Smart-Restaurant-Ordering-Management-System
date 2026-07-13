using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;

namespace DineFlow.Infrastructure.Restaurant;

public class Restaurant
{
    private const string DefaultOpeningHoursJson =
        "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = "AU";

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public RestaurantPaymentPolicy PaymentPolicy { get; set; } = RestaurantPaymentPolicy.PayAtCounterAllowed;

    public bool IsActive { get; set; } = true;

    public bool AcceptingOrders { get; set; } = true;

    public string OpeningHoursJson { get; set; } = DefaultOpeningHoursJson;

    public string SpecialOpeningDaysJson { get; set; } = "[]";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public ICollection<ApplicationUser> Users { get; set; } = [];
    public ICollection<MenuCategory> MenuCategories { get; set; } = [];
}

public enum RestaurantPaymentPolicy
{
    PrepayRequired = 0,
    PayAtCounterAllowed = 1
}
