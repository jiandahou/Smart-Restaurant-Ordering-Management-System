using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-017. The thresholds decide when a customer gets their money back, so the boundaries are
/// asserted rather than eyeballed.
/// </summary>
public sealed class OrderAcceptancePolicyTests
{
    private static readonly DateTime Now = new(2026, 8, 9, 12, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(OrderStatus.Pending, PaymentStatus.Paid, true)]
    [InlineData(OrderStatus.Pending, PaymentStatus.PartiallyRefunded, true)]
    [InlineData(OrderStatus.Pending, PaymentStatus.Unpaid, false)]
    [InlineData(OrderStatus.Pending, PaymentStatus.Failed, false)]
    [InlineData(OrderStatus.Accepted, PaymentStatus.Paid, false)]
    [InlineData(OrderStatus.Completed, PaymentStatus.Paid, false)]
    public void IsAwaitingAcceptance_OnlyCountsSettledMoneyOnAnUnacceptedOrder(
        OrderStatus orderStatus,
        PaymentStatus paymentStatus,
        bool expected)
    {
        Assert.Equal(expected, OrderAcceptancePolicy.IsAwaitingAcceptance(orderStatus, paymentStatus));
    }

    [Fact]
    public void WaitedForAcceptance_MeasuresFromSettlementNotOrderCreation()
    {
        // An order placed long ago but paid a minute ago is not the one keeping someone waiting.
        var waited = OrderAcceptancePolicy.WaitedForAcceptance(
            paidAtUtc: Now.AddMinutes(-1),
            createdAtUtc: Now.AddHours(-3),
            nowUtc: Now);

        Assert.Equal(TimeSpan.FromMinutes(1), waited);
    }

    [Fact]
    public void WaitedForAcceptance_FallsBackToCreationWhenNothingRecordedTheSettlement()
    {
        var waited = OrderAcceptancePolicy.WaitedForAcceptance(null, Now.AddMinutes(-8), Now);

        Assert.Equal(TimeSpan.FromMinutes(8), waited);
    }

    [Fact]
    public void WaitedForAcceptance_NeverGoesNegativeOnClockSkew()
    {
        var waited = OrderAcceptancePolicy.WaitedForAcceptance(Now.AddMinutes(5), Now, Now);

        Assert.Equal(TimeSpan.Zero, waited);
    }

    [Theory]
    [InlineData(4, false, false)]
    [InlineData(5, true, false)]
    [InlineData(9, true, false)]
    [InlineData(10, false, true)]
    [InlineData(45, false, true)]
    public void EscalationBoundariesAreInclusiveOfTheThreshold(
        int minutes,
        bool approaching,
        bool overdue)
    {
        var waited = TimeSpan.FromMinutes(minutes);

        Assert.Equal(approaching, OrderAcceptancePolicy.IsApproaching(waited));
        Assert.Equal(overdue, OrderAcceptancePolicy.IsOverdue(waited));
    }

    [Fact]
    public void CustomerCannotCancelBeforeTheThreshold()
    {
        Assert.False(OrderAcceptancePolicy.CanCustomerCancelForRefund(
            OrderStatus.Pending,
            PaymentStatus.Paid,
            PaymentMethod.Online,
            Now.AddMinutes(-19),
            Now.AddMinutes(-19),
            Now));
    }

    [Fact]
    public void CustomerCanCancelOnceTheThresholdIsReached()
    {
        Assert.True(OrderAcceptancePolicy.CanCustomerCancelForRefund(
            OrderStatus.Pending,
            PaymentStatus.Paid,
            PaymentMethod.Online,
            Now.AddMinutes(-20),
            Now.AddMinutes(-20),
            Now));
    }

    [Fact]
    public void CounterPaymentsAreExcluded()
    {
        // Settled face to face with no automated refund path; the customer talks to the counter.
        Assert.False(OrderAcceptancePolicy.CanCustomerCancelForRefund(
            OrderStatus.Pending,
            PaymentStatus.Paid,
            PaymentMethod.PayAtCounter,
            Now.AddHours(-2),
            Now.AddHours(-2),
            Now));
    }

    [Fact]
    public void AnAcceptedOrderCannotBeCancelledNoMatterHowLongItHasBeen()
    {
        // Once the kitchen has taken it the food may already be cooking; that is a refund request,
        // not a self-service cancellation.
        Assert.False(OrderAcceptancePolicy.CanCustomerCancelForRefund(
            OrderStatus.Accepted,
            PaymentStatus.Paid,
            PaymentMethod.Online,
            Now.AddHours(-5),
            Now.AddHours(-5),
            Now));
    }

    [Fact]
    public void CustomerGetsTheirWindowAfterBothStaffEscalations()
    {
        // The restaurant is warned, then escalated, and only then does the customer get the option.
        Assert.True(OrderAcceptancePolicy.WarningAfter < OrderAcceptancePolicy.OverdueAfter);
        Assert.True(OrderAcceptancePolicy.OverdueAfter < OrderAcceptancePolicy.CustomerCancellationAfter);
    }
}
