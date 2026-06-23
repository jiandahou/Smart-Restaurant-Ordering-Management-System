using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;

namespace DineFlow.Infrastructure.Restaurant;

public class Restaurant
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public RestaurantPaymentPolicy PaymentPolicy { get; set; } = RestaurantPaymentPolicy.PayAtCounterAllowed;

    public bool IsActive { get; set; } = true;

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
