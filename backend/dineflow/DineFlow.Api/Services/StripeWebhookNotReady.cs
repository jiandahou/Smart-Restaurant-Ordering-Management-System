namespace DineFlow.Api.Services;

/// <summary>
/// Raised when a Stripe event arrives before the thing it is about exists here yet.
/// </summary>
/// <remarks>
/// <para>
/// The webhook records each event id before running the handler, so a retry of the same event is
/// answered as a duplicate. That is right for work that was done, and wrong for work that was not:
/// a <c>charge.dispute.created</c> that arrived before its payment row was written was logged,
/// returned 200, and left in the dedup table — so Stripe's retry was answered "already seen" and the
/// dispute was never recorded at all. A dispute carries a response deadline; missing it loses the
/// money by default, and nothing in the product would have shown that it happened.
/// </para>
/// <para>
/// Throwing rather than returning is deliberate: the event id and the work it stands for are written
/// in one transaction, and this abandons both together, so a retry finds no record of the event and
/// starts over.
/// </para>
/// </remarks>
public sealed class StripeWebhookNotReadyException(string message) : Exception(message);

/// <summary>
/// How long the webhook keeps asking Stripe to try an event again.
/// </summary>
/// <remarks>
/// The race this covers resolves in seconds. Asking forever would be worse than the bug: Stripe
/// disables an endpoint that keeps failing, and then every event stops arriving, not just this one.
/// So an event that is still unmatched after a day is accepted and recorded — it is no longer a race,
/// it is something that will never match, and it needs a person rather than another retry.
/// </remarks>
public static class StripeWebhookRetryWindow
{
    public static readonly TimeSpan Duration = TimeSpan.FromHours(24);

    public static bool ShouldAskStripeToRetry(DateTime eventCreatedAtUtc, DateTime utcNow) =>
        utcNow - eventCreatedAtUtc < Duration;
}
