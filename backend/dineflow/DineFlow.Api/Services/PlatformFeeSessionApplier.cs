using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using DineFlow.Infrastructure.Restaurant;

namespace DineFlow.Api.Services;

/// <summary>What a platform activation-fee checkout session turned out to mean.</summary>
public enum PlatformFeeSessionOutcome
{
    /// <summary>Not this restaurant's current session. Nothing was written.</summary>
    Ignored,

    /// <summary>The fee is paid.</summary>
    Paid,

    /// <summary>The session completed but the money has not settled yet.</summary>
    AwaitingPayment,

    /// <summary>The session expired or failed without paying.</summary>
    Unpaid,
}

/// <summary>
/// Applies what Stripe says about an activation-fee checkout to the restaurant it belongs to.
/// </summary>
/// <remarks>
/// <para>
/// Extracted so the webhook and the reconciliation sweep write the same thing. They previously
/// could not, because only the webhook existed: a dropped event left a restaurant in
/// <see cref="PlatformSetupFeeStatus.Pending"/> with nothing in the system that would ever look
/// again. That was survivable while the status was decoration. It stops being survivable the moment
/// the status can close a shop, and the fix has to be one piece of logic rather than a second
/// implementation that agrees with the first until the day it does not.
/// </para>
/// <para>
/// One rule about the delinquency clock is enforced here: <b>paying may stop it, but nothing here
/// may start it.</b> Starting the clock is the direction that eventually takes a restaurant
/// offline, and it belongs to the sweep, which sees every fact at once and re-derives from scratch,
/// so events arriving out of order cannot leave a clock running that should have stopped. Stopping
/// it can only ever help somebody, and it has to happen the instant payment is seen — "I paid and
/// I am still locked out" is the one failure this feature must never produce.
/// </para>
/// </remarks>
public static class PlatformFeeSessionApplier
{
    /// <summary>The metadata marker that tells a checkout session apart from a diner's order.</summary>
    public const string SessionMode = "restaurant_platform_setup_fee";

    /// <param name="completed">
    /// Whether Stripe reports the session as finished, as opposed to expired or failed.
    /// </param>
    /// <param name="sessionPaymentStatus">Stripe's own <c>payment_status</c> on the session.</param>
    public static PlatformFeeSessionOutcome Apply(
        RestaurantEntity restaurant,
        string sessionId,
        bool completed,
        string? sessionPaymentStatus,
        string? paymentIntentId,
        DateTime utcNow)
    {
        // A session the restaurant has since moved on from says nothing about where it stands now.
        if (!string.Equals(
                restaurant.OneTimePlatformFeeCheckoutSessionId,
                sessionId,
                StringComparison.Ordinal))
        {
            return PlatformFeeSessionOutcome.Ignored;
        }

        var paid = completed
            && string.Equals(sessionPaymentStatus, "paid", StringComparison.OrdinalIgnoreCase);

        // Whatever the answer, it came from Stripe just now, and that is what earns the right to
        // act on it later.
        restaurant.PlatformBillingSyncedAt = utcNow;
        restaurant.UpdatedAt = utcNow;

        if (paid)
        {
            restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Paid;
            restaurant.OneTimePlatformFeePaidAt ??= utcNow;
            restaurant.OneTimePlatformFeePaymentIntentId = paymentIntentId;

            // Square again: the clock stops and any suspension lifts, in the same write, without
            // anyone having to ask an administrator.
            restaurant.PlatformBillingDelinquentSince = null;
            restaurant.PlatformBillingSuspendedAt = null;
            return PlatformFeeSessionOutcome.Paid;
        }

        if (completed)
        {
            // Completed but unsettled — a delayed method still clearing. Left alone deliberately:
            // the status stays Pending and the sweep will ask again.
            return PlatformFeeSessionOutcome.AwaitingPayment;
        }

        if (restaurant.OneTimePlatformFeePaidAt.HasValue)
        {
            // Already paid at some point, and this is an older session expiring behind it.
            return PlatformFeeSessionOutcome.Ignored;
        }

        // Expired or abandoned. The reusable link is cleared so the next attempt mints a fresh one.
        restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Failed;
        restaurant.OneTimePlatformFeeCheckoutUrl = null;
        restaurant.OneTimePlatformFeeIdempotencyKey = null;
        return PlatformFeeSessionOutcome.Unpaid;
    }

    /// <summary>The audit event name for an outcome, so both callers file it under the same word.</summary>
    public static string AuditEvent(PlatformFeeSessionOutcome outcome) => outcome switch
    {
        PlatformFeeSessionOutcome.Paid => "Restaurant.PlatformFeePaid",
        PlatformFeeSessionOutcome.AwaitingPayment => "Restaurant.PlatformFeeCheckoutAwaitingPayment",
        _ => "Restaurant.PlatformFeeCheckoutFailed",
    };

    public static string Describe(PlatformFeeSessionOutcome outcome, string restaurantName) => outcome switch
    {
        PlatformFeeSessionOutcome.Paid =>
            $"One-time platform fee paid by {restaurantName}.",
        PlatformFeeSessionOutcome.AwaitingPayment =>
            $"One-time platform fee checkout completed for {restaurantName} and is awaiting payment confirmation.",
        _ =>
            $"One-time platform fee checkout failed or expired for {restaurantName}.",
    };
}
