using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Billing;
using Microsoft.Extensions.Options;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The one place an unpaid restaurant is stopped from taking public orders.
/// </summary>
/// <remarks>
/// <para>
/// Every public path to placing an order runs through <c>GetAvailability</c> — the menu context a
/// diner loads, and the four call sites behind the cart. That is why the check lives there and
/// nowhere else, and why these tests are mostly about the ways it must <em>not</em> fire.
/// </para>
/// <para>
/// Four things have to be true at once before a shop closes: enforcement switched on, a billing
/// model assigned, a date published in advance and passed, and facts confirmed with Stripe
/// recently. Each test below removes exactly one of them and expects the shop to stay open.
/// </para>
/// </remarks>
public class PlatformBillingEnforcementTests
{
    /// <summary>
    /// Midday, deliberately: inside the default trading hours, so that "the shop is open" is the
    /// starting point and anything that closes it is the thing under test.
    /// </summary>
    private static readonly DateTime Now = new(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);

    private static RestaurantOperatingHoursService Service(bool enforcementEnabled = true) =>
        new(Options.Create(new PlatformBillingOptions { EnforcementEnabled = enforcementEnabled }));

    /// <summary>An unpaid restaurant, well past a deadline it was given a year ago.</summary>
    private static RestaurantEntity Unpaid() => new()
    {
        Name = "Laneway Noodles",
        Timezone = "UTC",
        IsActive = true,
        AcceptingOrders = true,
        OpeningHoursJson = RestaurantOperatingHoursService.DefaultOpeningHoursJson,
        SpecialOpeningDaysJson = "[]",
        PlatformBillingModel = PlatformBillingModel.OneTimeActivation,
        OneTimePlatformFeeCents = 9_900,
        PlatformBillingDelinquentSince = Now.AddDays(-60),
        PlatformBillingEnforcedFrom = Now.AddYears(-1),
        PlatformBillingSyncedAt = Now.AddMinutes(-5),
    };

    [Fact]
    public void AnUnpaidRestaurantPastItsDeadlineStopsTakingOrders()
    {
        var availability = Service().GetAvailability(Unpaid(), Now);

        Assert.False(availability.IsOrderingAvailable);
        Assert.Equal(PlatformBilling.SuspendedReason, availability.Reason);
    }

    /// <summary>
    /// The diner is told what any temporarily closed restaurant's customers are told. That this
    /// restaurant owes its supplier money damages the restaurant, is none of the diner's business,
    /// and is not something any restaurant would knowingly agree to show on its own menu page.
    /// </summary>
    [Fact]
    public void TheDinerIsNotToldWhy()
    {
        var message = Service().GetAvailability(Unpaid(), Now).Message;

        foreach (var leak in new[] { "unpaid", "platform", "fee", "billing", "subscription", "owe" })
        {
            Assert.DoesNotContain(leak, message, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>The emergency brake: one setting puts every shop back online.</summary>
    [Fact]
    public void WithEnforcementOffNothingIsEverStopped()
    {
        Assert.True(Service(enforcementEnabled: false).GetAvailability(Unpaid(), Now).IsOrderingAvailable);
    }

    /// <summary>
    /// The default for every restaurant that predates billing. No arithmetic on the other fields
    /// can close it, which is what makes turning this on a non-event.
    /// </summary>
    [Fact]
    public void ARestaurantOnNoBillingModelIsNeverStopped()
    {
        var restaurant = Unpaid();
        restaurant.PlatformBillingModel = PlatformBillingModel.None;

        Assert.True(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);
    }

    /// <summary>A restaurant is never closed by a deadline nobody published to it.</summary>
    [Fact]
    public void WithoutAPublishedDateNothingIsStopped()
    {
        var restaurant = Unpaid();
        restaurant.PlatformBillingEnforcedFrom = null;

        Assert.True(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);
    }

    /// <summary>
    /// The Stripe-outage case, and the most important of these. During an incident nobody's facts
    /// are fresh, so nobody is closed — while the clock keeps running underneath, so a genuinely
    /// unpaid restaurant is closed on the first pass after Stripe answers again.
    /// </summary>
    [Fact]
    public void StaleFactsCannotCloseAShop()
    {
        var restaurant = Unpaid();
        restaurant.PlatformBillingSyncedAt = Now - PlatformBilling.MaxFactAge - TimeSpan.FromMinutes(1);

        Assert.True(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);
    }

    /// <summary>Paying reopens ordering with no administrator in the loop.</summary>
    [Fact]
    public void PayingReopensOrderingImmediately()
    {
        var restaurant = Unpaid();
        Assert.False(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);

        restaurant.OneTimePlatformFeePaidAt = Now;

        Assert.True(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);
    }

    /// <summary>
    /// Being behind is a warning, not a closure. The whole point of the grace period is that it
    /// changes nothing until it ends.
    /// </summary>
    [Fact]
    public void BeingWithinTheGracePeriodChangesNothing()
    {
        var restaurant = Unpaid();
        restaurant.PlatformBillingDelinquentSince = Now.AddDays(-1);

        Assert.True(Service().GetAvailability(restaurant, Now).IsOrderingAvailable);
    }

    /// <summary>
    /// Billing does not take over the reasons a restaurant is already closed. A shut restaurant
    /// that also owes money should still say it is shut.
    /// </summary>
    [Fact]
    public void AnInactiveRestaurantStillReportsThatFirst()
    {
        var restaurant = Unpaid();
        restaurant.IsActive = false;

        Assert.Equal("Inactive", Service().GetAvailability(restaurant, Now).Reason);
    }
}
