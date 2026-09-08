using DineFlow.Api.Services;
using DineFlow.Infrastructure.Billing;
using DineFlow.Infrastructure.Restaurant;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// What a platform activation-fee checkout session does to the restaurant it belongs to.
/// </summary>
/// <remarks>
/// Shared by the webhook and the reconciliation sweep, so that a fact learned by being told and the
/// same fact learned by asking cannot be recorded two different ways. Most of what is asserted here
/// is about the direction of travel: paying may stop the delinquency clock, and nothing in this
/// file may start it.
/// </remarks>
public class PlatformFeeSessionApplierTests
{
    private const string Session = "cs_test_current";
    private static readonly DateTime Now = new(2026, 9, 8, 12, 0, 0, DateTimeKind.Utc);

    private static RestaurantEntity Awaiting(
        DateTime? delinquentSince = null,
        DateTime? suspendedAt = null,
        DateTime? paidAt = null) =>
        new()
        {
            Name = "Queue Count Kitchen",
            PlatformBillingModel = PlatformBillingModel.OneTimeActivation,
            OneTimePlatformFeeCents = 9_900,
            OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Pending,
            OneTimePlatformFeeCheckoutSessionId = Session,
            OneTimePlatformFeeCheckoutUrl = "https://checkout.stripe.com/c/pay/cs_test_current",
            OneTimePlatformFeeIdempotencyKey = "restaurant-platform-fee-abc",
            OneTimePlatformFeePaidAt = paidAt,
            PlatformBillingDelinquentSince = delinquentSince,
            PlatformBillingSuspendedAt = suspendedAt,
        };

    private static PlatformFeeSessionOutcome Apply(
        RestaurantEntity restaurant,
        bool completed = true,
        string? paymentStatus = "paid",
        string sessionId = Session) =>
        PlatformFeeSessionApplier.Apply(
            restaurant,
            sessionId,
            completed,
            paymentStatus,
            paymentIntentId: "pi_test_123",
            Now);

    /// <summary>
    /// The property this whole feature rests on: the moment payment is seen, the restaurant is
    /// square and any suspension lifts, without anyone having to ask an administrator. "I paid and
    /// I am still locked out" is the one outcome that must be impossible.
    /// </summary>
    [Fact]
    public void PayingClearsTheClockAndLiftsTheSuspensionImmediately()
    {
        var restaurant = Awaiting(
            delinquentSince: Now.AddDays(-40),
            suspendedAt: Now.AddDays(-10));

        Assert.Equal(PlatformFeeSessionOutcome.Paid, Apply(restaurant));

        Assert.Equal(PlatformSetupFeeStatus.Paid, restaurant.OneTimePlatformFeeStatus);
        Assert.Equal(Now, restaurant.OneTimePlatformFeePaidAt);
        Assert.Null(restaurant.PlatformBillingDelinquentSince);
        Assert.Null(restaurant.PlatformBillingSuspendedAt);
    }

    /// <summary>
    /// Every answer from Stripe, whatever it says, refreshes how recently the facts were confirmed.
    /// That stamp is what later earns the right to act on them.
    /// </summary>
    [Theory]
    [InlineData(true, "paid")]
    [InlineData(true, "unpaid")]
    [InlineData(false, null)]
    public void AnyAnswerFromStripeCountsAsHavingLooked(bool completed, string? paymentStatus)
    {
        var restaurant = Awaiting();

        Apply(restaurant, completed, paymentStatus);

        Assert.Equal(Now, restaurant.PlatformBillingSyncedAt);
    }

    /// <summary>
    /// The webhook and the sweep both see the same session, and the second one to arrive must not
    /// move the date the fee was paid.
    /// </summary>
    [Fact]
    public void SeeingThePaymentTwiceDoesNotMoveWhenItWasPaid()
    {
        var paidEarlier = Now.AddDays(-2);
        var restaurant = Awaiting(paidAt: paidEarlier);

        Apply(restaurant);

        Assert.Equal(paidEarlier, restaurant.OneTimePlatformFeePaidAt);
    }

    /// <summary>A session the restaurant has moved on from says nothing about where it stands now.</summary>
    [Fact]
    public void AStaleSessionIsIgnoredEntirely()
    {
        var restaurant = Awaiting();

        Assert.Equal(
            PlatformFeeSessionOutcome.Ignored,
            Apply(restaurant, sessionId: "cs_test_from_last_month"));

        Assert.Equal(PlatformSetupFeeStatus.Pending, restaurant.OneTimePlatformFeeStatus);
        Assert.Null(restaurant.OneTimePlatformFeePaidAt);
        Assert.Null(restaurant.PlatformBillingSyncedAt);
    }

    /// <summary>
    /// Completed but not settled — a delayed method still clearing. Left as Pending on purpose so
    /// the sweep asks again, rather than being recorded as a failure the customer never had.
    /// </summary>
    [Fact]
    public void ACompletedButUnsettledSessionWaitsRatherThanFailing()
    {
        var restaurant = Awaiting();

        Assert.Equal(
            PlatformFeeSessionOutcome.AwaitingPayment,
            Apply(restaurant, completed: true, paymentStatus: "unpaid"));

        Assert.Equal(PlatformSetupFeeStatus.Pending, restaurant.OneTimePlatformFeeStatus);
        Assert.NotNull(restaurant.OneTimePlatformFeeCheckoutUrl);
    }

    /// <summary>An abandoned checkout releases its link so the next attempt mints a fresh one.</summary>
    [Fact]
    public void AnExpiredSessionReleasesTheReusableLink()
    {
        var restaurant = Awaiting();

        Assert.Equal(
            PlatformFeeSessionOutcome.Unpaid,
            Apply(restaurant, completed: false, paymentStatus: null));

        Assert.Equal(PlatformSetupFeeStatus.Failed, restaurant.OneTimePlatformFeeStatus);
        Assert.Null(restaurant.OneTimePlatformFeeCheckoutUrl);
        Assert.Null(restaurant.OneTimePlatformFeeIdempotencyKey);
    }

    /// <summary>
    /// An older session expiring behind a fee that is already paid must not undo the payment.
    /// </summary>
    [Fact]
    public void AnExpiryArrivingAfterPaymentDoesNotUndoIt()
    {
        var restaurant = Awaiting(paidAt: Now.AddDays(-1));
        restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Paid;

        Assert.Equal(
            PlatformFeeSessionOutcome.Ignored,
            Apply(restaurant, completed: false, paymentStatus: null));

        Assert.Equal(PlatformSetupFeeStatus.Paid, restaurant.OneTimePlatformFeeStatus);
    }

    /// <summary>
    /// The direction rule, stated as a test. Starting the clock is the move that eventually takes a
    /// restaurant offline, and it belongs to the sweep — which sees every fact at once — not to a
    /// webhook that only knows about one session.
    /// </summary>
    [Theory]
    [InlineData(true, "paid")]
    [InlineData(true, "unpaid")]
    [InlineData(false, null)]
    public void NothingHereEverStartsTheDelinquencyClock(bool completed, string? paymentStatus)
    {
        var restaurant = Awaiting();

        Apply(restaurant, completed, paymentStatus);

        Assert.Null(restaurant.PlatformBillingDelinquentSince);
    }
}

/// <summary>
/// Where the delinquency clock should stand, given the facts as they are now.
/// </summary>
public class PlatformBillingDelinquencyTests
{
    private static readonly DateTime Now = new(2026, 9, 8, 12, 0, 0, DateTimeKind.Utc);

    private static PlatformBillingSnapshot Owing(DateTime? delinquentSince) =>
        new(
            PlatformBillingModel.OneTimeActivation,
            ActivationFeePaid: false,
            SubscriptionStatus: null,
            SubscriptionCancelAtPeriodEnd: false,
            DelinquentSince: delinquentSince,
            EnforcedFrom: null,
            FactsSyncedAt: Now);

    [Fact]
    public void BeingBehindWithNoClockStartsOneNow()
    {
        Assert.Equal(Now, PlatformBilling.DeriveDelinquentSince(Owing(null), Now));
    }

    /// <summary>
    /// Restarting a running clock every pass would mean the grace period never elapses, and the
    /// warning that has been counting down for three weeks would silently reset.
    /// </summary>
    [Fact]
    public void AClockAlreadyRunningIsLeftWhereItIs()
    {
        var started = Now.AddDays(-21);

        Assert.Equal(started, PlatformBilling.DeriveDelinquentSince(Owing(started), Now));
    }

    /// <summary>Square means no clock at all, not a stopped one.</summary>
    [Fact]
    public void BeingSquareRemovesTheClock()
    {
        var paid = Owing(Now.AddDays(-40)) with { ActivationFeePaid = true };

        Assert.Null(PlatformBilling.DeriveDelinquentSince(paid, Now));
    }

    /// <summary>
    /// A restaurant on no model owes nothing, whatever a stale clock left on the row might say.
    /// </summary>
    [Fact]
    public void ARestaurantOnNoModelHasNoClock()
    {
        var free = Owing(Now.AddDays(-400)) with { Model = PlatformBillingModel.None };

        Assert.Null(PlatformBilling.DeriveDelinquentSince(free, Now));
    }
}
