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

    public string? StripeAccountId { get; set; }

    public bool StripeDetailsSubmitted { get; set; }

    public bool StripeChargesEnabled { get; set; }

    public bool StripePayoutsEnabled { get; set; }

    public string StripeRequirementsDueJson { get; set; } = "[]";

    public DateTime? StripeConnectedAt { get; set; }

    public DateTime? StripeAccountUpdatedAt { get; set; }

    /// <summary>
    /// Per-order platform fee in basis points. 100 basis points = 1%.
    /// Defaults to zero so a newly-created restaurant is free.
    /// </summary>
    public int OrderPlatformFeeBps { get; set; }

    /// <summary>
    /// Optional one-time platform activation fee in minor currency units.
    /// Defaults to zero, which is treated as waived.
    /// </summary>
    public long OneTimePlatformFeeCents { get; set; }

    public PlatformSetupFeeStatus OneTimePlatformFeeStatus { get; set; } = PlatformSetupFeeStatus.NotRequired;

    public string? OneTimePlatformFeeCheckoutSessionId { get; set; }

    public string? OneTimePlatformFeePaymentIntentId { get; set; }

    public string? OneTimePlatformFeeCheckoutUrl { get; set; }

    public string? OneTimePlatformFeeIdempotencyKey { get; set; }

    public DateTime? OneTimePlatformFeePaidAt { get; set; }

    public bool IsActive { get; set; } = true;

    public bool AcceptingOrders { get; set; } = true;

    /// <summary>
    /// When set, a pause that lapses on its own. Ordering resumes once this UTC instant passes,
    /// so a rush-hour pause can't be left on by accident. Null means the pause is indefinite.
    /// </summary>
    public DateTime? AcceptingOrdersPausedUntil { get; set; }

    public bool AutoAcceptOrders { get; set; }

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

public enum PlatformSetupFeeStatus
{
    NotRequired = 0,
    Pending = 1,
    Paid = 2,
    Failed = 3
}
