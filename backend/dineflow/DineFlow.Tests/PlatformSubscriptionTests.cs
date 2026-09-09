using DineFlow.Api.Services;
using DineFlow.Infrastructure.Billing;
using Stripe;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// What a Stripe subscription does to the restaurant paying for it.
/// </summary>
/// <remarks>
/// Facts in, facts stored. What they mean for whether the restaurant may trade is the sweep's to
/// decide, because only the sweep sees every fact at once and so cannot be misled by events
/// arriving in the wrong order.
/// </remarks>
public class PlatformSubscriptionTests
{
    private static readonly DateTime Now = new(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);

    private static Subscription StripeSubscription(
        string status = "active",
        bool cancelAtPeriodEnd = false,
        string id = "sub_current",
        string customerId = "cus_1",
        string priceId = "price_monthly") =>
        new()
        {
            Id = id,
            Status = status,
            CancelAtPeriodEnd = cancelAtPeriodEnd,
            CustomerId = customerId,
            Items = new StripeList<SubscriptionItem>
            {
                Data =
                [
                    new SubscriptionItem
                    {
                        Price = new Price { Id = priceId },
                        CurrentPeriodEnd = Now.AddDays(30),
                    },
                ],
            },
        };

    private static RestaurantEntity Subscriber(
        DateTime? delinquentSince = null,
        DateTime? suspendedAt = null) =>
        new()
        {
            Name = "Laneway Noodles",
            Timezone = "Australia/Sydney",
            PlatformBillingModel = PlatformBillingModel.Subscription,
            PlatformSubscriptionId = "sub_current",
            PlatformBillingDelinquentSince = delinquentSince,
            PlatformBillingSuspendedAt = suspendedAt,
        };

    [Fact]
    public void ApplyingASubscriptionRecordsWhatStripeSaid()
    {
        var restaurant = Subscriber();

        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription(), Now);

        Assert.Equal("sub_current", restaurant.PlatformSubscriptionId);
        Assert.Equal("active", restaurant.PlatformSubscriptionStatus);
        Assert.Equal("cus_1", restaurant.PlatformStripeCustomerId);
        Assert.Equal("price_monthly", restaurant.PlatformSubscriptionPriceId);
        Assert.Equal(Now.AddDays(30), restaurant.PlatformSubscriptionCurrentPeriodEndAt);
        Assert.Equal(Now, restaurant.PlatformBillingSyncedAt);
    }

    /// <summary>
    /// The property the whole feature rests on: payment observed, clock stopped, suspension lifted,
    /// in the same write and without anyone having to ask an administrator.
    /// </summary>
    [Fact]
    public void PayingClearsTheClockAndLiftsTheSuspension()
    {
        var restaurant = Subscriber(
            delinquentSince: Now.AddDays(-45),
            suspendedAt: Now.AddDays(-10));

        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription("active"), Now);

        Assert.Null(restaurant.PlatformBillingDelinquentSince);
        Assert.Null(restaurant.PlatformBillingSuspendedAt);
    }

    /// <summary>
    /// Giving notice is not falling behind. The period is paid for, so the clock stays stopped.
    /// </summary>
    [Fact]
    public void SchedulingACancellationIsNotArrears()
    {
        var restaurant = Subscriber(delinquentSince: Now.AddDays(-45));

        PlatformSubscriptionService.ApplySubscription(
            restaurant,
            StripeSubscription("active", cancelAtPeriodEnd: true),
            Now);

        Assert.True(restaurant.PlatformSubscriptionCancelAtPeriodEnd);
        Assert.Null(restaurant.PlatformBillingDelinquentSince);
    }

    /// <summary>
    /// The direction rule. Starting the clock is what eventually takes a restaurant offline, and it
    /// belongs to the sweep — not to a webhook that knows about one subscription.
    /// </summary>
    [Theory]
    [InlineData("past_due")]
    [InlineData("unpaid")]
    [InlineData("canceled")]
    public void FallingBehindNeverStartsTheClockHere(string status)
    {
        var restaurant = Subscriber();

        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription(status), Now);

        Assert.Equal(status, restaurant.PlatformSubscriptionStatus);
        Assert.Null(restaurant.PlatformBillingDelinquentSince);
    }

    /// <summary>
    /// A clock already running is left alone by an event that does not settle anything, so the month
    /// somebody has been counting down does not silently restart.
    /// </summary>
    [Fact]
    public void AnUnpaidUpdateLeavesARunningClockWhereItIs()
    {
        var started = Now.AddDays(-10);
        var restaurant = Subscriber(delinquentSince: started);

        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription("past_due"), Now);

        Assert.Equal(started, restaurant.PlatformBillingDelinquentSince);
    }

    /// <summary>
    /// Once the facts are stored, the standing follows from them — including that being behind is a
    /// warning until a published enforcement date has passed.
    /// </summary>
    [Fact]
    public void TheStandingFollowsFromTheStoredFacts()
    {
        var restaurant = Subscriber(delinquentSince: Now.AddDays(-45));
        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription("past_due"), Now);

        Assert.Equal(PlatformBillingStanding.PastDue, restaurant.BillingStanding(Now));

        restaurant.PlatformBillingEnforcedFrom = Now.AddDays(-1);
        Assert.Equal(PlatformBillingStanding.Suspended, restaurant.BillingStanding(Now));

        PlatformSubscriptionService.ApplySubscription(restaurant, StripeSubscription("active"), Now);
        Assert.Equal(PlatformBillingStanding.Current, restaurant.BillingStanding(Now));
    }
}
