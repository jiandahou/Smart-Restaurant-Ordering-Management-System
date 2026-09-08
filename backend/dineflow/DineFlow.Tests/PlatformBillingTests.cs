using DineFlow.Infrastructure.Billing;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Whether a restaurant is square with the platform, and whether that may close its shop front.
/// </summary>
/// <remarks>
/// Suspension takes a working business offline, so most of what follows is about the ways it must
/// <em>not</em> happen. Every case where the answer is "keep trading" is a case where getting it
/// wrong costs a restaurant a day of service and the platform a customer, against an upside of one
/// month of one subscription.
/// </remarks>
public class PlatformBillingTests
{
    private static readonly DateTime Now = new(2026, 9, 8, 12, 0, 0, DateTimeKind.Utc);

    private static PlatformBillingSnapshot Subscribed(
        string? status = "active",
        bool cancelAtPeriodEnd = false,
        DateTime? delinquentSince = null,
        DateTime? enforcedFrom = null,
        DateTime? syncedAt = null) =>
        new(
            PlatformBillingModel.Subscription,
            ActivationFeePaid: false,
            SubscriptionStatus: status,
            SubscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
            DelinquentSince: delinquentSince,
            EnforcedFrom: enforcedFrom,
            FactsSyncedAt: syncedAt ?? Now);

    /// <summary>A snapshot where every lock is open and only the clock decides.</summary>
    private static PlatformBillingSnapshot Overdue(TimeSpan by) =>
        Subscribed(
            status: "past_due",
            delinquentSince: Now - PlatformBilling.GracePeriod - by,
            enforcedFrom: Now.AddYears(-1));

    // ---- Nothing owed -------------------------------------------------------------------------

    /// <summary>
    /// The default for every restaurant that existed before billing did. No later field can make it
    /// suspendable, which is what makes deploying this a non-event.
    /// </summary>
    [Fact]
    public void ARestaurantOnNoModelIsNeverBilledAndNeverSuspended()
    {
        var snapshot = new PlatformBillingSnapshot(
            PlatformBillingModel.None,
            ActivationFeePaid: false,
            SubscriptionStatus: "unpaid",
            SubscriptionCancelAtPeriodEnd: false,
            DelinquentSince: Now.AddYears(-5),
            EnforcedFrom: Now.AddYears(-5),
            FactsSyncedAt: Now);

        Assert.Equal(PlatformBillingStanding.NotBilled, PlatformBilling.Evaluate(snapshot, Now));
        Assert.False(PlatformBilling.BlocksPublicOrdering(PlatformBillingStanding.NotBilled));
    }

    // ---- Paid up ------------------------------------------------------------------------------

    [Theory]
    [InlineData("active")]
    [InlineData("trialing")]
    [InlineData("ACTIVE")]
    public void AHealthySubscriptionIsCurrent(string status)
    {
        Assert.Equal(
            PlatformBillingStanding.Current,
            PlatformBilling.Evaluate(Subscribed(status), Now));
    }

    [Fact]
    public void APaidActivationFeeIsCurrentForever()
    {
        var snapshot = new PlatformBillingSnapshot(
            PlatformBillingModel.OneTimeActivation,
            ActivationFeePaid: true,
            SubscriptionStatus: null,
            SubscriptionCancelAtPeriodEnd: false,
            DelinquentSince: Now.AddYears(-3),
            EnforcedFrom: Now.AddYears(-3),
            FactsSyncedAt: Now);

        Assert.Equal(PlatformBillingStanding.Current, PlatformBilling.Evaluate(snapshot, Now));
    }

    /// <summary>
    /// A subscription set to stop at the end of the period has been paid for that period. Reading
    /// it as arrears would suspend a customer who owes nothing, on their way out, for the crime of
    /// giving notice.
    /// </summary>
    [Fact]
    public void ASubscriptionCancellingAtPeriodEndIsNotInArrears()
    {
        var leaving = Subscribed(
            status: "canceled",
            cancelAtPeriodEnd: true,
            delinquentSince: Now - PlatformBilling.GracePeriod.Add(TimeSpan.FromDays(1)),
            enforcedFrom: Now.AddYears(-1));

        Assert.Equal(PlatformBillingStanding.Current, PlatformBilling.Evaluate(leaving, Now));
    }

    // ---- Behind, but trading ------------------------------------------------------------------

    [Fact]
    public void FallingBehindWarnsBeforeItCloses()
    {
        var snapshot = Subscribed(
            status: "past_due",
            delinquentSince: Now.AddDays(-1),
            enforcedFrom: Now.AddYears(-1));

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(snapshot, Now));
        Assert.False(PlatformBilling.BlocksPublicOrdering(PlatformBillingStanding.PastDue));
    }

    /// <summary>The grace period is a promise; the last second of it is still inside it.</summary>
    [Fact]
    public void TheFinalSecondOfGraceStillTrades()
    {
        var snapshot = Subscribed(
            status: "past_due",
            delinquentSince: Now - PlatformBilling.GracePeriod + TimeSpan.FromSeconds(1),
            enforcedFrom: Now.AddYears(-1));

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(snapshot, Now));
    }

    [Fact]
    public void TheMomentGraceElapsesItSuspends()
    {
        Assert.Equal(
            PlatformBillingStanding.Suspended,
            PlatformBilling.Evaluate(Overdue(TimeSpan.Zero), Now));
    }

    /// <summary>An unpaid restaurant nobody has started a clock on is not overdue by default.</summary>
    [Fact]
    public void WithNoClockRunningNothingElapses()
    {
        var snapshot = Subscribed(
            status: "unpaid",
            delinquentSince: null,
            enforcedFrom: Now.AddYears(-1));

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(snapshot, Now));
    }

    // ---- The three locks ----------------------------------------------------------------------

    /// <summary>
    /// Enforcement is opted into per restaurant. Until somebody publishes a date, no arithmetic on
    /// the other fields can close the shop.
    /// </summary>
    [Fact]
    public void WithoutAPublishedDateNothingSuspends()
    {
        var snapshot = Overdue(TimeSpan.FromDays(365)) with { EnforcedFrom = null };

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(snapshot, Now));
    }

    [Fact]
    public void ADateStillInTheFutureDoesNotSuspendYet()
    {
        var snapshot = Overdue(TimeSpan.FromDays(365)) with { EnforcedFrom = Now.AddDays(1) };

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(snapshot, Now));
    }

    /// <summary>
    /// The Stripe-outage case. Stale facts may warn; they may never close a shop. The clock keeps
    /// running underneath, so a genuinely unpaid restaurant suspends on the first pass after the
    /// facts come back.
    /// </summary>
    [Fact]
    public void StaleFactsWarnButDoNotSuspend()
    {
        var stale = Overdue(TimeSpan.FromDays(2)) with
        {
            FactsSyncedAt = Now - PlatformBilling.MaxFactAge - TimeSpan.FromMinutes(1),
        };

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(stale, Now));

        var recovered = stale with { FactsSyncedAt = Now };
        Assert.Equal(PlatformBillingStanding.Suspended, PlatformBilling.Evaluate(recovered, Now));
    }

    /// <summary>Facts nobody has ever confirmed are not fresh facts.</summary>
    [Fact]
    public void FactsNeverConfirmedCannotSuspend()
    {
        var never = Overdue(TimeSpan.FromDays(2)) with { FactsSyncedAt = null };

        Assert.Equal(PlatformBillingStanding.PastDue, PlatformBilling.Evaluate(never, Now));
        Assert.False(PlatformBilling.IsFreshEnoughToAct(null, Now));
    }

    /// <summary>
    /// A status this version has never met is treated as behind — which warns — rather than as
    /// healthy. Being wrong here costs a warning, not a closure, because the locks still apply.
    /// </summary>
    [Theory]
    [InlineData("past_due")]
    [InlineData("unpaid")]
    [InlineData("incomplete")]
    [InlineData("paused")]
    [InlineData("something_stripe_added_later")]
    [InlineData(null)]
    public void AnUnhealthyOrUnknownStatusIsBehind(string? status)
    {
        Assert.Equal(
            PlatformBillingStanding.PastDue,
            PlatformBilling.Evaluate(Subscribed(status, enforcedFrom: Now.AddYears(-1)), Now));
    }

    // ---- Derived values shown on screens ------------------------------------------------------

    [Fact]
    public void TheDeadlineIsDerivedFromTheOneClock()
    {
        var since = Now.AddDays(-3);

        Assert.Equal(since + PlatformBilling.GracePeriod, PlatformBilling.GraceEndsAt(since));
        Assert.Null(PlatformBilling.GraceEndsAt(null));
    }

    [Fact]
    public void TheCountdownNeverRunsBackwards()
    {
        var longPast = Now - PlatformBilling.GracePeriod - TimeSpan.FromDays(10);

        Assert.Equal(TimeSpan.Zero, PlatformBilling.TimeUntilSuspension(longPast, Now));
        Assert.Null(PlatformBilling.TimeUntilSuspension(null, Now));
        Assert.Equal(
            TimeSpan.FromDays(30),
            PlatformBilling.TimeUntilSuspension(Now, Now));
    }

    // ---- What each audience is told -----------------------------------------------------------

    /// <summary>
    /// A diner must never be told that this restaurant owes its supplier money. It damages the
    /// restaurant, it is none of the diner's business, and no restaurant would knowingly agree to
    /// it being displayed on their own menu page.
    /// </summary>
    [Fact]
    public void TheDinerIsNotToldAboutMoney()
    {
        var shown = PlatformBilling.ExplainToDiner();

        foreach (var leak in new[] { "unpaid", "platform", "fee", "billing", "subscription", "owe" })
        {
            Assert.DoesNotContain(leak, shown, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>Staff get the real reason, and are told their data is intact.</summary>
    [Fact]
    public void StaffAreToldTheRealReasonAndThatNothingIsLost()
    {
        var suspended = PlatformBilling.ExplainToStaff(PlatformBillingStanding.Suspended);

        Assert.Contains("unpaid", suspended, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("untouched", suspended, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(PlatformBilling.ExplainToStaff(PlatformBillingStanding.Current));
        Assert.Empty(PlatformBilling.ExplainToStaff(PlatformBillingStanding.NotBilled));
    }

    // ---- Only one standing closes anything ----------------------------------------------------

    [Fact]
    public void OnlySuspensionStopsOrdering()
    {
        foreach (var standing in Enum.GetValues<PlatformBillingStanding>())
        {
            Assert.Equal(
                standing == PlatformBillingStanding.Suspended,
                PlatformBilling.BlocksPublicOrdering(standing));
        }
    }
}
