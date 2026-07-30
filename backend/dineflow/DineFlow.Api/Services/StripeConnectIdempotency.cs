namespace DineFlow.Api.Services;

/// <summary>
/// Idempotency keys for Stripe Connect account creation.
///
/// The key exists to stop a double-click creating two connected accounts. It must not pin a
/// *failed* attempt forever: Stripe replays a cached response — errors included — for 24 hours, so
/// a key that never changes turns a transient configuration problem (Accounts v1 disabled, a bad
/// key, an outage) into one that only a code change and redeploy can clear. That happened twice
/// while switching sandboxes.
///
/// Bucketing by time keeps rapid retries deduplicated while letting a later retry through as a
/// genuinely new request.
/// </summary>
public static class StripeConnectIdempotency
{
    /// <summary>How long repeated connect clicks for one restaurant share a key.</summary>
    public static readonly TimeSpan AccountCreationWindow = TimeSpan.FromMinutes(10);

    public static string BuildAccountCreationKey(Guid restaurantId, DateTime utcNow)
    {
        var windowTicks = AccountCreationWindow.Ticks;
        var bucket = new DateTime(utcNow.Ticks / windowTicks * windowTicks, DateTimeKind.Utc);

        return $"restaurant-connect-account-{restaurantId:N}-{bucket:yyyyMMddHHmm}";
    }
}
