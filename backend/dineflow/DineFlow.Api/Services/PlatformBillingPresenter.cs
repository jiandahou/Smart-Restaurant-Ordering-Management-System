using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Infrastructure.Billing;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Api.Services;

/// <summary>
/// Turns a restaurant's billing facts into the block its own staff are shown.
/// </summary>
/// <remarks>
/// One builder for every screen that shows this, because the number on a badge and the sentence on
/// a page have to be the same claim. The operations record a single restaurant polls and the list a
/// platform owner reads both come through here.
/// </remarks>
public static class PlatformBillingPresenter
{
    public static RestaurantBillingStandingResponse Describe(RestaurantEntity restaurant, DateTime utcNow)
    {
        var described = Describe(
            restaurant.ToBillingSnapshot(),
            restaurant.OneTimePlatformFeeCents,
            restaurant.Currency,
            utcNow);

        described.CurrentPeriodEndAt = restaurant.PlatformSubscriptionCurrentPeriodEndAt;
        return described;
    }

    public static RestaurantBillingStandingResponse Describe(
        PlatformBillingSnapshot snapshot,
        long activationFeeCents,
        string currency,
        DateTime utcNow)
    {
        var standing = PlatformBilling.Evaluate(snapshot, utcNow);

        return new RestaurantBillingStandingResponse
        {
            Model = snapshot.Model.ToString(),
            Standing = standing.ToString(),
            DelinquentSince = snapshot.DelinquentSince,
            SuspendsAt = PlatformBilling.SuspendsAt(snapshot.DelinquentSince, snapshot.Timezone),
            EnforcedFrom = snapshot.EnforcedFrom,
            FactsSyncedAt = snapshot.FactsSyncedAt,
            SubscriptionStatus = snapshot.SubscriptionStatus,
            SubscriptionCancelAtPeriodEnd = snapshot.SubscriptionCancelAtPeriodEnd,
            AmountDueCents = AmountDue(snapshot, activationFeeCents, standing),
            Currency = string.IsNullOrWhiteSpace(currency) ? "aud" : currency.ToLowerInvariant(),
            BlocksOrdering = PlatformBilling.BlocksPublicOrdering(standing),
            Message = PlatformBilling.ExplainToStaff(standing),
        };
    }

    /// <summary>
    /// What settling it would cost right now.
    /// </summary>
    /// <remarks>
    /// Zero once square, so a screen can show the figure without first asking whether it applies.
    /// A subscription's amount is not known here — it lives on the price in Stripe — and reporting
    /// a wrong number is worse than reporting none, so it stays zero until subscriptions exist.
    /// </remarks>
    private static long AmountDue(
        PlatformBillingSnapshot snapshot,
        long activationFeeCents,
        PlatformBillingStanding standing) =>
        standing is PlatformBillingStanding.PastDue or PlatformBillingStanding.Suspended
        && snapshot.Model == PlatformBillingModel.OneTimeActivation
            ? activationFeeCents
            : 0;
}
