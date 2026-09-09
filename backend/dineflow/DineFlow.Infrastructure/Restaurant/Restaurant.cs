using DineFlow.Infrastructure.Billing;
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

    public string LegalBusinessName { get; set; } = string.Empty;

    public string? Abn { get; set; }

    public bool GstRegistered { get; set; }

    public bool PricesIncludeGst { get; set; } = true;

    public string BusinessContactEmail { get; set; } = string.Empty;

    public string RefundContactEmail { get; set; } = string.Empty;

    /// <summary>Customer-facing disclosure only. DineFlow does not currently calculate surcharges.</summary>
    public string? CustomerSurchargeNotice { get; set; }

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

    /// <summary>
    /// What the platform charges this restaurant. <see cref="PlatformBillingModel.None"/> — the
    /// default, and what every restaurant predating billing carries — owes nothing and can never be
    /// suspended.
    /// </summary>
    public PlatformBillingModel PlatformBillingModel { get; set; } = PlatformBillingModel.None;

    /// <summary>
    /// When the current spell of owing the platform money began, or null when nothing is owed.
    /// </summary>
    /// <remarks>
    /// The only clock. The deadline is derived from it rather than stored, so the grace period can
    /// be changed without rewriting history and two rows can never disagree about how long a month
    /// is. Written by the reconciliation sweep alone — webhooks record what Stripe said, and the
    /// sweep decides what it means, so events arriving out of order cannot leave a clock running
    /// that should have stopped.
    /// </remarks>
    public DateTime? PlatformBillingDelinquentSince { get; set; }

    /// <summary>
    /// The date this restaurant was told enforcement would begin. Null means never.
    /// </summary>
    /// <remarks>
    /// Per restaurant rather than one global switch, because the first restaurant worth enforcing
    /// against should not drag every other one with it, and because "we told them, on this date" is
    /// a thing that has to be answerable per tenant.
    /// </remarks>
    public DateTime? PlatformBillingEnforcedFrom { get; set; }

    /// <summary>When ordering was actually suspended, for the audit trail. Null while trading.</summary>
    public DateTime? PlatformBillingSuspendedAt { get; set; }

    /// <summary>The platform's Stripe customer for this restaurant, created once and kept.</summary>
    /// <remarks>
    /// Checkout mints its own customer when not given one, so a second subscription attempt would
    /// create a second customer and the billing portal would then open on the wrong card.
    /// </remarks>
    public string? PlatformStripeCustomerId { get; set; }

    public string? PlatformSubscriptionId { get; set; }

    /// <summary>
    /// Stripe's own subscription status, stored as the word Stripe used.
    /// </summary>
    /// <remarks>
    /// Not mapped to an enum of our own. The rule reads a handful of these as healthy and treats
    /// everything else — including a status this version has never seen — as behind, which warns
    /// rather than closes. Mapping would turn a new Stripe status into a parse failure instead.
    /// </remarks>
    public string? PlatformSubscriptionStatus { get; set; }

    /// <summary>The price actually being charged, snapshotted from the subscription item.</summary>
    public string? PlatformSubscriptionPriceId { get; set; }

    /// <summary>When the paid-for period ends, which is also when a scheduled cancel takes effect.</summary>
    public DateTime? PlatformSubscriptionCurrentPeriodEndAt { get; set; }

    /// <summary>
    /// Whether the subscription is set to stop at the end of the period it has already paid for.
    /// </summary>
    /// <remarks>
    /// A customer giving notice, not a customer in arrears. Treating it as arrears would suspend
    /// somebody who owes nothing on their way out.
    /// </remarks>
    public bool PlatformSubscriptionCancelAtPeriodEnd { get; set; }

    public string? PlatformSubscriptionCheckoutSessionId { get; set; }

    public string? PlatformSubscriptionCheckoutUrl { get; set; }

    public string? PlatformSubscriptionIdempotencyKey { get; set; }

    /// <summary>
    /// When the billing facts above were last confirmed against Stripe.
    /// </summary>
    /// <remarks>
    /// A suspension is only as good as the payment record behind it, and that record arrives by
    /// webhook — which is to say, sometimes it does not. Nothing may be suspended on facts older
    /// than <see cref="PlatformBilling.MaxFactAge"/>.
    /// </remarks>
    public DateTime? PlatformBillingSyncedAt { get; set; }

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
