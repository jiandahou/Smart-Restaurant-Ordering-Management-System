namespace DineFlow.Infrastructure.Payments;

/// <summary>Which Stripe endpoint an event was delivered to.</summary>
public enum StripeWebhookDestination
{
    /// <summary>The platform's own account: activation fees, subscriptions, invoices.</summary>
    Platform,

    /// <summary>A restaurant's connected account: the charges customers actually make.</summary>
    ConnectedAccount,
}

/// <summary>
/// Which events a given webhook secret is allowed to speak for.
/// </summary>
/// <remarks>
/// <para>
/// Two endpoints, two signing secrets: one for the platform account and one for connected accounts.
/// Verification tried both and took whichever passed, then processed the event as though the
/// question of where it came from had been answered. It had not. A secret proves that whoever held
/// <em>that</em> secret sent the payload; it says nothing about whether they were entitled to speak
/// for the other endpoint, and the code went on to act on the event either way.
/// </para>
/// <para>
/// The binding needs no list of event types to keep up to date, because Stripe already puts the
/// answer in the payload: an event from a connected account carries that account's id, and one from
/// the platform carries none. That field is inside the signature, so once the signature verifies it
/// is as trustworthy as the rest of the event — and it is the same fact the endpoint split is
/// built on. So the rule is simply that the two must agree.
/// </para>
/// <para>
/// <c>docs/testing/payment-system-test-cases.md</c> has asserted this as PS-WEB-02 for some time,
/// which is worth saying plainly: the test case was written, marked P0, and described behaviour the
/// code did not have.
/// </para>
/// </remarks>
public static class StripeWebhookRouting
{
    /// <summary>Where an event came from, read off the signed payload.</summary>
    public static StripeWebhookDestination DestinationOf(string? eventStripeAccount) =>
        string.IsNullOrWhiteSpace(eventStripeAccount)
            ? StripeWebhookDestination.Platform
            : StripeWebhookDestination.ConnectedAccount;

    /// <summary>
    /// Whether a secret belonging to <paramref name="verifiedWith"/> may speak for this event.
    /// </summary>
    /// <param name="verifiedWith">
    /// The endpoint whose secret verified the signature, or null when the configuration cannot tell
    /// the two apart — one secret configured, or the same secret entered for both. Nothing can be
    /// bound in that case, and refusing everything would take a working shop offline over a
    /// settings page, so it is allowed and the caller says so in the log.
    /// </param>
    public static bool Accepts(StripeWebhookDestination? verifiedWith, string? eventStripeAccount) =>
        verifiedWith is null || verifiedWith == DestinationOf(eventStripeAccount);

    /// <summary>Why it was refused, for the log. The sender is told nothing beyond "invalid".</summary>
    public static string ExplainRefusal(StripeWebhookDestination verifiedWith, string? eventStripeAccount) =>
        verifiedWith == StripeWebhookDestination.Platform
            ? $"signed with the platform secret but sent from connected account {eventStripeAccount}"
            : "signed with the Connect secret but carries no connected account";
}
