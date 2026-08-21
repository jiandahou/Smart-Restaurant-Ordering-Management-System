using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Admin Orders offered "Mark paid" on a cancelled order while Admin Payments, reading the same
/// order, called it not payable. The endpoint refused it either way — so the button could only ever
/// produce an error, and the error arrives after the money has been taken at the till.
///
/// <para>
/// Four screens each decided this for themselves with the same two-clause test. The rule lives here
/// now so a screen can only be wrong by not asking.
/// </para>
/// </summary>
public sealed class CounterSettlementEligibilityTests
{
    [Fact]
    public void CashMayBeTakenForAnUnpaidCounterOrder()
    {
        Assert.True(OrderPaymentEligibility.CanSettleAtCounter(
            PaymentMethod.PayAtCounter, PaymentStatus.Unpaid, OrderStatus.Preparing));
    }

    [Theory]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void NoMoneyIsTakenForAnOrderNobodyIsMaking(OrderStatus status)
    {
        // The reported defect.
        Assert.False(OrderPaymentEligibility.CanSettleAtCounter(
            PaymentMethod.PayAtCounter, PaymentStatus.Unpaid, status));
    }

    [Fact]
    public void ACompletedOrderMayStillBePaidFor()
    {
        // Eating first and paying on the way out is the ordinary case for pay-at-counter. Sweeping
        // it in with cancelled would take the counter's own workflow away.
        Assert.True(OrderPaymentEligibility.CanSettleAtCounter(
            PaymentMethod.PayAtCounter, PaymentStatus.Unpaid, OrderStatus.Completed));
    }

    [Theory]
    [InlineData(PaymentStatus.Paid)]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.NotRequired)]
    [InlineData(PaymentStatus.Refunded)]
    public void MoneyAlreadyAccountedForIsNotAskedForAgain(PaymentStatus status)
    {
        Assert.False(OrderPaymentEligibility.CanSettleAtCounter(
            PaymentMethod.PayAtCounter, status, OrderStatus.Preparing));
    }

    [Fact]
    public void AnOnlineOrderIsNotSettledAtTheCounterByThisRoute()
    {
        Assert.False(OrderPaymentEligibility.CanSettleAtCounter(
            PaymentMethod.Online, PaymentStatus.Unpaid, OrderStatus.Preparing));
    }

    [Fact]
    public void EachRefusalSaysWhichOneItWas()
    {
        // The till operator has to know whether to reopen the order, take nothing, or do nothing.
        Assert.Equal(
            "Cancelled or rejected orders cannot be settled.",
            OrderPaymentEligibility.DescribeCounterRefusal(
                PaymentMethod.PayAtCounter, PaymentStatus.Unpaid, OrderStatus.Cancelled));
        Assert.Equal(
            "Fully refunded orders cannot be charged again.",
            OrderPaymentEligibility.DescribeCounterRefusal(
                PaymentMethod.PayAtCounter, PaymentStatus.Refunded, OrderStatus.Preparing));
        Assert.Equal(
            "Only pay-at-counter orders can be settled at the counter.",
            OrderPaymentEligibility.DescribeCounterRefusal(
                PaymentMethod.Online, PaymentStatus.Unpaid, OrderStatus.Preparing));
    }

    [Fact]
    public void TheEndpointAsksTheRuleRatherThanRepeatingIt()
    {
        // A copy of the rule inside the controller is a copy that can drift from the one the
        // screens mirror, which is how this defect existed at all.
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf("HttpPost(\"{orderId:guid}/counter-payment\")", StringComparison.Ordinal);

        Assert.True(start >= 0);

        var body = source[start..(start + 4000)];

        Assert.Contains("OrderPaymentEligibility.CanSettleAtCounter", body, StringComparison.Ordinal);
        Assert.DoesNotContain("order.Status is OrderStatus.Cancelled or OrderStatus.Rejected", body, StringComparison.Ordinal);
    }

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "AdminOrdersController.cs");
    }
}
