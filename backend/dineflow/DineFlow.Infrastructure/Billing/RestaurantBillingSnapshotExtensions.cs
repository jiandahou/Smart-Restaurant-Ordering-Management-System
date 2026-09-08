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
            // Subscriptions are not issued yet, so this is always null today. The rule already
            // reads it, which is why the wiring lands here rather than in a later edit to the rule.
            SubscriptionStatus: null,
            SubscriptionCancelAtPeriodEnd: false,
            DelinquentSince: restaurant.PlatformBillingDelinquentSince,
            EnforcedFrom: restaurant.PlatformBillingEnforcedFrom,
            FactsSyncedAt: restaurant.PlatformBillingSyncedAt,
            Timezone: restaurant.Timezone);

    public static PlatformBillingStanding BillingStanding(
        this RestaurantEntity restaurant,
        DateTime utcNow) =>
        PlatformBilling.Evaluate(restaurant.ToBillingSnapshot(), utcNow);
}
