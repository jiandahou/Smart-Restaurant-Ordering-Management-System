namespace DineFlow.Api.Options;

/// <summary>Settings for the platform's own billing of restaurants.</summary>
public class PlatformBillingOptions
{
    public const string SectionName = "PlatformBilling";

    /// <summary>
    /// Whether an unpaid restaurant may actually be stopped from taking public orders.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Off by default, and it is a brake rather than the way enforcement is rolled out. Enforcement
    /// is opted into per restaurant, on a date published to that restaurant in advance, because a
    /// single switch would mean the first restaurant worth enforcing against drags every other one
    /// with it, and because "we told them, on this date" has to be answerable per tenant.
    /// </para>
    /// <para>
    /// What this is for is the morning something is discovered to be wrong — a bad deploy, a Stripe
    /// incident that outlasted the staleness guard, a rule that turns out to read a status the wrong
    /// way. One setting puts every shop back online while it is worked out, without editing a row
    /// per restaurant under pressure.
    /// </para>
    /// </remarks>
    public bool EnforcementEnabled { get; set; }
}
