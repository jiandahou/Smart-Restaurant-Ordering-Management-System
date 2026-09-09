namespace DineFlow.Api.Contracts.Restaurant;

/// <summary>
/// Where a restaurant stands with the platform, in the terms its own staff need.
/// </summary>
/// <remarks>
/// <para>
/// Sent to staff-authenticated callers only. It says plainly that money is owed, which is the one
/// thing the diner-facing availability message must never say.
/// </para>
/// <para>
/// <see cref="SuspendsAt"/> rather than the raw month mark is what any countdown should be drawn
/// from: suspension waits for the small hours of the restaurant's own morning, so the two are
/// hours apart and only one of them is when anything actually happens.
/// </para>
/// </remarks>
public sealed class RestaurantBillingStandingResponse
{
    /// <summary>"None", "OneTimeActivation" or "Subscription".</summary>
    public string Model { get; set; } = "None";

    /// <summary>"NotBilled", "Current", "PastDue" or "Suspended".</summary>
    public string Standing { get; set; } = "NotBilled";

    /// <summary>When the current spell of owing money began, or null when nothing is owed.</summary>
    public DateTime? DelinquentSince { get; set; }

    /// <summary>
    /// The moment online ordering stops if nothing is paid, or null when nothing is counting down.
    /// </summary>
    public DateTime? SuspendsAt { get; set; }

    /// <summary>The date this restaurant was told enforcement would begin. Null means never.</summary>
    public DateTime? EnforcedFrom { get; set; }

    /// <summary>
    /// When these facts were last confirmed with Stripe, or null if never.
    /// </summary>
    /// <remarks>
    /// Shown because it explains an answer that would otherwise look wrong: a restaurant well past
    /// its deadline still reads as behind rather than suspended while its facts are stale, and this
    /// is the field that says why.
    /// </remarks>
    public DateTime? FactsSyncedAt { get; set; }

    /// <summary>What settling it would cost right now, in minor currency units.</summary>
    public long AmountDueCents { get; set; }

    public string Currency { get; set; } = "aud";

    /// <summary>Whether this standing is currently stopping the restaurant taking public orders.</summary>
    public bool BlocksOrdering { get; set; }

    /// <summary>The explanation for staff, empty when there is nothing to explain.</summary>
    public string Message { get; set; } = string.Empty;
}
