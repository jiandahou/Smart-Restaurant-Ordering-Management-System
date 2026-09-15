namespace DineFlow.Api.Services;

/// <summary>
/// How long a hosted Stripe Checkout link stays payable.
/// </summary>
/// <remarks>
/// <para>
/// Left unset, Stripe keeps a session payable for 24 hours. For a restaurant order that is far too
/// long: the kitchen closes, the table turns over, and the order sits Pending all the while, still
/// chargeable by a link somebody left open on a phone.
/// </para>
/// <para>
/// Shortening it does not by itself stop a customer meeting Stripe's expired page — that page is a
/// dead end whatever the timeout, which is why the customer keeps a DineFlow tab to come back to.
/// What it does is bound how long an unpaid order can stay in limbo, and make the expired state
/// something the restaurant sees during service rather than the next day.
/// </para>
/// </remarks>
public static class HostedCheckoutExpiry
{
    /// <summary>Stripe rejects anything shorter than 30 minutes from creation.</summary>
    public static readonly TimeSpan Minimum = TimeSpan.FromMinutes(30);

    /// <summary>Stripe rejects anything longer than 24 hours from creation.</summary>
    public static readonly TimeSpan Maximum = TimeSpan.FromHours(24);

    /// <summary>
    /// Long enough to find a card, ask a question, or let a slow bank app finish; short enough that
    /// an abandoned order is resolved within the same service.
    /// </summary>
    public static readonly TimeSpan Default = TimeSpan.FromMinutes(60);

    /// <summary>
    /// The absolute expiry to send to Stripe, clamped to what Stripe will accept so a misconfigured
    /// window becomes a shorter or longer link rather than a checkout that cannot be created at all.
    /// </summary>
    public static DateTime ExpiresAt(DateTime utcNow, TimeSpan? window = null)
    {
        var requested = window ?? Default;

        if (requested < Minimum)
        {
            requested = Minimum;
        }
        else if (requested > Maximum)
        {
            requested = Maximum;
        }

        return utcNow.Add(requested);
    }
}
