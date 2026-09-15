using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Checking out reserves stock and a pickup number before any payment. Releasing them only ever
/// happened when somebody cancelled, so a customer who reached the payment screen and walked away
/// held those portions permanently — and could repeat it, with no account and no payment, until the
/// dish read as sold out having sold nothing.
/// </summary>
public class AbandonedOrderPolicyTests
{
    private static readonly DateTime Now = new(2026, 8, 12, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AnUnpaidOrderExpiresTwentyMinutesAfterItWasPlaced()
    {
        Assert.Equal(TimeSpan.FromMinutes(20), AbandonedOrderPolicy.ExpiresAfter);
        Assert.Equal(Now.AddMinutes(20), AbandonedOrderPolicy.ExpiresAt(Now));
    }

    [Theory]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Cancelled)]
    public void AnOrderWithNoPaymentInFlightExpiresOnceItIsDue(PaymentStatus paymentStatus)
    {
        Assert.True(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, paymentStatus, PaymentMethod.Online, Now.AddMinutes(-21), Now));
    }

    /// <summary>
    /// The customer may be on the card form right now. Expiring this would cancel an order out from
    /// under somebody in the middle of paying for it.
    /// </summary>
    [Fact]
    public void AnOrderWithALiveCheckoutSessionIsNeverExpired()
    {
        Assert.False(AbandonedOrderPolicy.HasNoPaymentInFlight(PaymentStatus.Pending));
        Assert.False(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, PaymentStatus.Pending, PaymentMethod.Online, Now.AddMinutes(-120), Now));
    }

    [Theory]
    [InlineData(PaymentStatus.Paid)]
    [InlineData(PaymentStatus.Refunded)]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.NotRequired)]
    public void AnOrderThatIsSettledIsNotAbandoned(PaymentStatus paymentStatus)
    {
        Assert.False(AbandonedOrderPolicy.HasNoPaymentInFlight(paymentStatus));
        Assert.False(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, paymentStatus, PaymentMethod.Online, Now.AddMinutes(-120), Now));
    }

    /// A kitchen that has taken the order owns it now, whatever the payment says.
    [Theory]
    [InlineData(OrderStatus.Accepted)]
    [InlineData(OrderStatus.Preparing)]
    [InlineData(OrderStatus.Ready)]
    [InlineData(OrderStatus.Completed)]
    [InlineData(OrderStatus.Cancelled)]
    public void AnOrderTheRestaurantHasActedOnIsNotExpired(OrderStatus orderStatus)
    {
        Assert.False(AbandonedOrderPolicy.HasExpired(
            orderStatus, PaymentStatus.Unpaid, PaymentMethod.Online, Now.AddMinutes(-120), Now));
    }

    [Fact]
    public void AnOrderInsideItsWindowIsLeftAlone()
    {
        Assert.False(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.Online, Now.AddMinutes(-19), Now));
        // The boundary belongs to the customer, not to the sweep.
        Assert.True(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.Online, Now.AddMinutes(-20), Now));
    }

    /// <summary>
    /// A counter order is Unpaid by arrangement: the customer said they would settle at the till and
    /// the kitchen may already be cooking. Expiring it cancels a meal out from under a diner who is
    /// sitting there waiting for it, and hands the stock back while the food is on the pass.
    /// </summary>
    [Fact]
    public void ACounterOrderIsNeverExpiredHoweverLongItSitsUnpaid()
    {
        Assert.False(AbandonedOrderPolicy.IsGovernedBy(PaymentMethod.PayAtCounter));
        Assert.False(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.PayAtCounter, Now.AddDays(-1), Now));
    }

    [Fact]
    public void AnOnlineOrderIsStillGoverned()
    {
        Assert.True(AbandonedOrderPolicy.IsGovernedBy(PaymentMethod.Online));
        Assert.True(AbandonedOrderPolicy.HasExpired(
            OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.Online, Now.AddMinutes(-21), Now));
    }
}
