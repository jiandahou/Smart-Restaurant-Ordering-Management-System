using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Restaurant;
using Xunit;

using OrderEntity = DineFlow.Infrastructure.Orders.Order;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// Choosing a payment method used to be reachable only through the cart that produced the order.
/// Once that cart was submitted and its token gone, a customer whose restaurant had switched Stripe
/// off had an order that could not be paid and could only be abandoned.
/// </summary>
public class OrderPaymentMethodPolicyTests
{
    private static RestaurantEntity Restaurant(
        bool counterAllowed = true,
        bool stripeReady = true) => new()
        {
            Id = Guid.NewGuid(),
            Name = "The DineFlow Kitchen",
            Currency = "AUD",
            PaymentPolicy = counterAllowed
                ? RestaurantPaymentPolicy.PayAtCounterAllowed
                : RestaurantPaymentPolicy.PrepayRequired,
            StripeAccountId = stripeReady ? "acct_test" : null,
            StripeChargesEnabled = stripeReady,
        };

    private static OrderEntity Order(
        RestaurantEntity restaurant,
        PaymentStatus paymentStatus = PaymentStatus.Unpaid,
        OrderStatus status = OrderStatus.Pending,
        params Payment[] payments)
    {
        var order = new OrderEntity
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            Restaurant = restaurant,
            OrderNumber = "ORD-1",
            Status = status,
            PaymentStatus = paymentStatus,
            PaymentMethod = PaymentMethod.Online,
        };

        foreach (var payment in payments)
        {
            order.Payments.Add(payment);
        }

        return order;
    }

    [Fact]
    public void AnUnpaidOrderMaySwitchToTheCounter()
    {
        Assert.Null(OrderPaymentMethodPolicy.Refuse(Order(Restaurant()), PaymentMethod.PayAtCounter));
    }

    [Fact]
    public void AnUnpaidOrderMaySwitchToOnlineWhenTheRestaurantCanTakeCards()
    {
        Assert.Null(OrderPaymentMethodPolicy.Refuse(Order(Restaurant()), PaymentMethod.Online));
    }

    /// <summary>
    /// The case that made this necessary: Stripe turned off after the order was placed. Counter has
    /// to stay open, or the order is unpayable.
    /// </summary>
    [Fact]
    public void OnlineIsRefusedButCounterStaysOpenWhenStripeIsOff()
    {
        var restaurant = Restaurant(stripeReady: false);

        Assert.Contains(
            "not available",
            OrderPaymentMethodPolicy.Refuse(Order(restaurant), PaymentMethod.Online),
            StringComparison.OrdinalIgnoreCase);
        Assert.Null(OrderPaymentMethodPolicy.Refuse(Order(restaurant), PaymentMethod.PayAtCounter));
    }

    [Fact]
    public void CounterIsRefusedWhenTheRestaurantRequiresPrepayment()
    {
        var refusal = OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(counterAllowed: false)),
            PaymentMethod.PayAtCounter);

        Assert.Contains("requires online payment", refusal, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void APaidOrderCannotChangeHowItWasPaid()
    {
        var refusal = OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(), PaymentStatus.Paid),
            PaymentMethod.PayAtCounter);

        Assert.Contains("after payment", refusal, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Found by a randomised walk over the endpoint: a partially refunded order accepted a switch to
    /// the counter and came back Unpaid. Money had been taken and part of it given back, yet the
    /// order then read as owing its full total — so staff would collect it a second time at the till.
    /// Refunded and NotRequired sat in the same hole, since none of them are Paid either.
    /// </summary>
    [Theory]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.Refunded)]
    [InlineData(PaymentStatus.NotRequired)]
    public void AnOrderWhoseMoneyHasAlreadyMovedCannotChangeHowItIsPaid(PaymentStatus paymentStatus)
    {
        var refusal = OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(), paymentStatus),
            PaymentMethod.PayAtCounter);

        Assert.Contains("after payment", refusal, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>The statuses that still owe money must stay changeable, or the fix above strands them.</summary>
    [Theory]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.Pending)]
    public void AnOrderThatStillOwesMoneyMayStillChoose(PaymentStatus paymentStatus)
    {
        Assert.Null(OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(), paymentStatus),
            PaymentMethod.PayAtCounter));
    }

    /// <summary>
    /// A live checkout session may be taking money right now. Switching underneath it is how
    /// somebody pays for an order that has already been marked settled at the till.
    /// </summary>
    [Fact]
    public void AnOrderWithAPaymentInFlightIsLeftAlone()
    {
        var refusal = OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(), PaymentStatus.Unpaid, OrderStatus.Pending,
                new Payment { Status = PaymentStatus.Pending, Provider = PaymentProviders.Stripe }),
            PaymentMethod.PayAtCounter);

        Assert.Contains("while an online payment is pending", refusal, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void AClosedOrderCannotChangeAnything(OrderStatus status)
    {
        var refusal = OrderPaymentMethodPolicy.Refuse(
            Order(Restaurant(), PaymentStatus.Unpaid, status),
            PaymentMethod.PayAtCounter);

        Assert.Contains("no longer open", refusal, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CapabilityChecksReadTheRestaurantHonestly()
    {
        Assert.True(OrderPaymentMethodPolicy.AllowsCounterPayment(Restaurant()));
        Assert.False(OrderPaymentMethodPolicy.AllowsCounterPayment(Restaurant(counterAllowed: false)));
        Assert.True(OrderPaymentMethodPolicy.AllowsOnlinePayment(Restaurant()));
        Assert.False(OrderPaymentMethodPolicy.AllowsOnlinePayment(Restaurant(stripeReady: false)));
        Assert.False(OrderPaymentMethodPolicy.AllowsOnlinePayment(null));
    }
}
