using DineFlow.Infrastructure.Time;

namespace DineFlow.Infrastructure.Billing;

/// <summary>What the platform charges this restaurant, if anything.</summary>
public enum PlatformBillingModel
{
    /// <summary>
    /// Nothing is owed to the platform, so nothing can fall behind.
    /// </summary>
    /// <remarks>
    /// Every restaurant that existed before billing did lands here, because both fee fields default
    /// to zero. It is the first of the reasons that turning this on cannot take anybody's shop
    /// offline.
    /// </remarks>
    None = 0,

    /// <summary>A single activation fee, and then nothing further.</summary>
    OneTimeActivation = 1,

    /// <summary>A Stripe subscription, billed on its own schedule.</summary>
    Subscription = 2,
}

/// <summary>Where a restaurant stands with the platform right now.</summary>
public enum PlatformBillingStanding
{
    /// <summary>Owes nothing. Cannot be suspended.</summary>
    NotBilled,

    /// <summary>Paid up.</summary>
    Current,

    /// <summary>Behind, but still inside the grace period. Trades normally and is warned.</summary>
    PastDue,

    /// <summary>Behind past the grace period, and enforcement is on. Stops taking public orders.</summary>
    Suspended,
}

/// <summary>
/// Everything the standing is derived from, gathered in one place so the rule can be read at a
/// glance and driven from a test without a database.
/// </summary>
/// <param name="DelinquentSince">
/// When the current spell of owing money began — the <em>only</em> clock. Null means nothing is
/// running, which is read as "not behind" rather than "behind since forever".
/// </param>
/// <param name="EnforcedFrom">
/// The date this restaurant was told enforcement would begin. Null means never, and no combination
/// of the other fields can suspend it.
/// </param>
/// <param name="FactsSyncedAt">
/// When these facts were last confirmed against Stripe. Stale facts may warn but must never
/// suspend.
/// </param>
/// <param name="Timezone">
/// The restaurant's own zone, because the moment ordering stops is a wall-clock decision rather
/// than a UTC one.
/// </param>
public readonly record struct PlatformBillingSnapshot(
    PlatformBillingModel Model,
    bool ActivationFeePaid,
    string? SubscriptionStatus,
    bool SubscriptionCancelAtPeriodEnd,
    DateTime? DelinquentSince,
    DateTime? EnforcedFrom,
    DateTime? FactsSyncedAt,
    string Timezone = "UTC");

/// <summary>
/// Whether a restaurant is square with the platform, and what that means for its shop front.
/// </summary>
/// <remarks>
/// <para>
/// Kept as one function over plain values rather than as checks spread through the controllers,
/// because the answer decides whether a business can take money today. A rule in one place can be
/// read, tested at its boundaries and changed once; the same rule restated in four call sites
/// drifts, and the drift shows up as a shop that is open to some endpoints and closed to others.
/// </para>
/// <para>
/// Falling behind is deliberately slow to bite. A card expires, an invoice bounces, a bookkeeper is
/// on leave — none of that is a reason to take a restaurant's ordering offline the same afternoon.
/// The cost of suspending a paying customer by mistake is a day of lost trade and a lost customer;
/// the cost of carrying an unpaid one another month is a month of one subscription. Those are not
/// the same size, and every default here is set by that asymmetry.
/// </para>
/// <para>
/// Three independent things must all be true before anyone is suspended: a model has been assigned,
/// a date was published in advance and has passed, and the facts behind the decision were confirmed
/// with Stripe recently. Any one of them missing means the shop stays open.
/// </para>
/// </remarks>
public static class PlatformBilling
{
    /// <summary>
    /// How long a restaurant keeps trading after it first owes something.
    /// </summary>
    /// <remarks>
    /// A month, because that is the unit a restaurant's own bookkeeping runs on, and because it
    /// doubles as the trial: a new shop can open, take orders and see the thing working before it
    /// has paid for anything. That is why there is no separate trial period to keep in step.
    /// </remarks>
    public static readonly TimeSpan GracePeriod = TimeSpan.FromDays(30);

    /// <summary>
    /// How old the Stripe-derived facts may be and still be allowed to close a shop.
    /// </summary>
    /// <remarks>
    /// A suspension is only as good as the payment record it rests on, and that record arrives by
    /// webhook — which is to say, sometimes it does not. Refusing to act on facts older than this
    /// turns a whole class of failure into a delay instead of an outage: during a Stripe incident
    /// nobody's facts are fresh, so nobody is suspended, while the clock keeps running and a
    /// genuinely unpaid restaurant is suspended on the next pass once Stripe answers again.
    /// </remarks>
    public static readonly TimeSpan MaxFactAge = TimeSpan.FromHours(6);

    /// <summary>The reason code an availability check reports when billing is what closed the shop.</summary>
    public const string SuspendedReason = "billing_suspended";

    /// <summary>
    /// The hour of the restaurant's own morning that a suspension is allowed to take effect.
    /// </summary>
    /// <remarks>
    /// A deadline computed in UTC lands wherever it lands, and a month from an ordinary Tuesday
    /// afternoon is an ordinary Thursday evening — which is to say, dinner service. Taking ordering
    /// down mid-service turns a billing decision into an incident: tickets stop arriving while
    /// there are people in the dining room waiting for food. Holding it to four in the morning
    /// costs at most a few more hours of unpaid trading and means the shop is always closed when it
    /// happens.
    /// </remarks>
    public const int SuspensionHourLocal = 4;

    /// <summary>
    /// Stripe subscription statuses that mean the platform is being paid.
    /// </summary>
    /// <remarks>
    /// <c>trialing</c> is here even though no trial is ever requested. If Stripe reports one — a
    /// coupon, a price configured with a trial, a later change to how these are created — the
    /// honest reading is that Stripe considers the subscription in good standing, and a status this
    /// code has not met before is not a reason to close somebody's shop.
    /// </remarks>
    private static readonly HashSet<string> HealthyStatuses =
        new(StringComparer.OrdinalIgnoreCase) { "active", "trialing" };

    /// <param name="utcNow">Passed in rather than read, so the boundaries can be tested.</param>
    public static PlatformBillingStanding Evaluate(PlatformBillingSnapshot snapshot, DateTime utcNow)
    {
        if (!IsBilled(snapshot))
        {
            return PlatformBillingStanding.NotBilled;
        }

        if (IsPaidUp(snapshot))
        {
            return PlatformBillingStanding.Current;
        }

        return CanSuspend(snapshot, utcNow)
            ? PlatformBillingStanding.Suspended
            : PlatformBillingStanding.PastDue;
    }

    private static bool IsBilled(PlatformBillingSnapshot snapshot) =>
        snapshot.Model is PlatformBillingModel.OneTimeActivation or PlatformBillingModel.Subscription;

    /// <summary>
    /// Whether the platform is currently being paid.
    /// </summary>
    /// <remarks>
    /// The clock starts at the first failed charge — <c>past_due</c> — and not at the end of
    /// Stripe's own retry ladder. Stripe spends two to three weeks retrying a declined card before
    /// it gives up and marks a subscription <c>unpaid</c> or <c>canceled</c>, so anchoring there
    /// would quietly turn a month of grace into six or seven weeks of free trading. A month should
    /// mean a month, counted from the day the money first did not arrive.
    /// </remarks>
    private static bool IsPaidUp(PlatformBillingSnapshot snapshot) => snapshot.Model switch
    {
        PlatformBillingModel.OneTimeActivation => snapshot.ActivationFeePaid,

        // A subscription set to stop at the end of the period has been paid for that period. It is
        // a customer leaving, not a customer in arrears, and treating it as arrears would suspend
        // somebody who owes nothing. Delinquency starts if the period ends without payment.
        PlatformBillingModel.Subscription =>
            (snapshot.SubscriptionStatus is not null
                && HealthyStatuses.Contains(snapshot.SubscriptionStatus))
            || snapshot.SubscriptionCancelAtPeriodEnd,

        _ => true,
    };

    /// <summary>
    /// The three locks between owing money and being closed, all of which must be open.
    /// </summary>
    private static bool CanSuspend(PlatformBillingSnapshot snapshot, DateTime utcNow)
    {
        // Told in advance, and the day has come. A restaurant is never closed by a deadline it was
        // not given.
        if (snapshot.EnforcedFrom is not DateTime enforcedFrom || utcNow < enforcedFrom)
        {
            return false;
        }

        // The clock has to have been started by something, and the moment it points at has to have
        // arrived. No start, no elapsed time, no closure.
        if (SuspendsAt(snapshot.DelinquentSince, snapshot.Timezone) is not DateTime suspendsAt ||
            utcNow < suspendsAt)
        {
            return false;
        }

        return IsFreshEnoughToAct(snapshot.FactsSyncedAt, utcNow);
    }

    /// <summary>
    /// Whether the payment facts are recent enough to close a shop on.
    /// </summary>
    /// <remarks>
    /// Facts that have never been confirmed are not fresh. That is the strict reading and it is the
    /// safe one: a restaurant nobody has checked with Stripe is a restaurant nobody knows is unpaid.
    /// </remarks>
    public static bool IsFreshEnoughToAct(DateTime? factsSyncedAt, DateTime utcNow) =>
        factsSyncedAt is DateTime syncedAt && utcNow - syncedAt <= MaxFactAge;

    /// <summary>
    /// When the grace period runs out, or null when no clock is running.
    /// </summary>
    /// <remarks>
    /// Derived rather than stored. The stored form was a date on every row, which meant the grace
    /// period could not be changed without rewriting history, and two rows could disagree about how
    /// long a month is. One constant, applied to everybody, at the moment the question is asked.
    /// </remarks>
    public static DateTime? GraceEndsAt(DateTime? delinquentSince) =>
        delinquentSince is DateTime since ? since + GracePeriod : null;

    /// <summary>
    /// The moment ordering actually stops: the first <see cref="SuspensionHourLocal"/> in the
    /// restaurant's own morning at or after the month is up.
    /// </summary>
    /// <remarks>
    /// This, not <see cref="GraceEndsAt"/>, is what a countdown should count towards. Showing the
    /// raw month mark would have the screen reach zero hours before anything happens, which reads
    /// as a broken warning the first time and as one to ignore every time after.
    /// </remarks>
    public static DateTime? SuspendsAt(DateTime? delinquentSince, string timezone) =>
        GraceEndsAt(delinquentSince) is DateTime graceEnds
            ? RestaurantClock.NextLocalHourAtOrAfter(graceEnds, timezone, SuspensionHourLocal)
            : null;

    /// <summary>
    /// How long is left before suspension, or null when nothing is counting down.
    /// </summary>
    /// <remarks>
    /// Never negative: once the moment has passed there is no time left, and a negative span would
    /// render as a countdown running backwards on the screens that show it.
    /// </remarks>
    public static TimeSpan? TimeUntilSuspension(
        DateTime? delinquentSince,
        string timezone,
        DateTime utcNow) =>
        SuspendsAt(delinquentSince, timezone) is DateTime deadline
            ? deadline > utcNow ? deadline - utcNow : TimeSpan.Zero
            : null;

    public static bool BlocksPublicOrdering(PlatformBillingStanding standing) =>
        standing == PlatformBillingStanding.Suspended;

    /// <summary>
    /// Where the delinquency clock should stand, given the facts as they are now.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Re-derived rather than nudged, so a clock that should never have been running is corrected on
    /// the next pass instead of persisting as a deadline nobody can explain. Square means no clock
    /// at all, not a stopped one.
    /// </para>
    /// <para>
    /// A clock that is already running is left where it is. Restarting it every pass would mean the
    /// grace period never elapses; moving it back to when the debt was technically incurred would
    /// mean a restaurant discovering it is already out of time. Neither is a month's notice.
    /// </para>
    /// </remarks>
    public static DateTime? DeriveDelinquentSince(PlatformBillingSnapshot snapshot, DateTime utcNow)
    {
        if (!IsBilled(snapshot) || IsPaidUp(snapshot))
        {
            return null;
        }

        return snapshot.DelinquentSince ?? utcNow;
    }

    /// <summary>
    /// What a diner is told when billing has closed the shop.
    /// </summary>
    /// <remarks>
    /// Deliberately says nothing about money owed to the platform. A customer reading that this
    /// restaurant has not paid its supplier learns something that harms the restaurant, is none of
    /// their business, and would be a strange thing for the restaurant to have agreed to. The
    /// wording matches an ordinary temporary closure, because from where the diner stands that is
    /// exactly what it is.
    /// </remarks>
    public static string ExplainToDiner() =>
        "This restaurant is not accepting online orders at the moment.";

    /// <summary>What the restaurant's own staff are told, which is where the real reason belongs.</summary>
    public static string ExplainToStaff(PlatformBillingStanding standing) => standing switch
    {
        PlatformBillingStanding.Suspended =>
            "Online ordering is paused because the platform account is unpaid. Settling it reopens "
            + "ordering straight away — your orders, history and settings are untouched.",
        PlatformBillingStanding.PastDue =>
            "The platform account is unpaid. Online ordering keeps working until the due date.",
        _ => string.Empty,
    };
}
