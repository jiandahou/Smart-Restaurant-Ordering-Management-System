using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Infrastructure.Billing;

/// <summary>
/// Reads a restaurant's billing facts into the shape the rule is written against.
/// </summary>
/// <remarks>
/// Kept apart from <see cref="PlatformBilling"/> so the rule itself takes only plain values: it can
/// then be driven from a test without building an entity, and it can be applied inside a database
/// projection where no entity exists. This is the same split the opening-hours service already
/// makes between its entity overload and its field overload.
/// </remarks>
public static class RestaurantBillingSnapshotExtensions
{
    public static PlatformBillingSnapshot ToBillingSnapshot(this RestaurantEntity restaurant) =>
        new(
            restaurant.PlatformBillingModel,
            ActivationFeePaid: restaurant.OneTimePlatformFeePaidAt is not null,
            SubscriptionStatus: restaurant.PlatformSubscriptionStatus,
            SubscriptionCancelAtPeriodEnd: restaurant.PlatformSubscriptionCancelAtPeriodEnd,
            DelinquentSince: restaurant.PlatformBillingDelinquentSince,
            EnforcedFrom: restaurant.PlatformBillingEnforcedFrom,
            FactsSyncedAt: restaurant.PlatformBillingSyncedAt,
            Timezone: restaurant.Timezone);

    public static PlatformBillingStanding BillingStanding(
        this RestaurantEntity restaurant,
        DateTime utcNow) =>
        PlatformBilling.Evaluate(restaurant.ToBillingSnapshot(), utcNow);

    /// <summary>
    /// Whether the platform is currently being paid, ignoring deadlines entirely.
    /// </summary>
    /// <remarks>
    /// Asked when a payment has just been observed and the only question is whether to stop the
    /// clock. Deliberately independent of dates, so that clearing a clock never depends on one.
    /// </remarks>
    public static bool BillingStandingIsHealthy(this RestaurantEntity restaurant) =>
        PlatformBilling.Evaluate(
            restaurant.ToBillingSnapshot() with { DelinquentSince = null, EnforcedFrom = null },
            DateTime.UtcNow) is PlatformBillingStanding.Current or PlatformBillingStanding.NotBilled;
}
