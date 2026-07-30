using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class FrontCounterOrderPolicyTests
{
    [Fact]
    public void OnlyReadyOrdersCanBeCompleted()
    {
        Assert.False(FrontCounterOrderPolicy.CanComplete(
            OrderStatus.Pending,
            PaymentMethod.Online,
            PaymentStatus.Paid));
        Assert.True(FrontCounterOrderPolicy.CanComplete(
            OrderStatus.Ready,
            PaymentMethod.Online,
            PaymentStatus.Paid));
        Assert.True(FrontCounterOrderPolicy.CanComplete(
            OrderStatus.Ready,
            PaymentMethod.Online,
            PaymentStatus.PartiallyRefunded));
        Assert.False(FrontCounterOrderPolicy.CanComplete(
            OrderStatus.Ready,
            PaymentMethod.PayAtCounter,
            PaymentStatus.Unpaid));
    }

    [Fact]
    public void RefundedOrdersCannotBePaidOrCompleted()
    {
        Assert.False(FrontCounterOrderPolicy.CanRecordCounterPayment(
            OrderStatus.Ready,
            PaymentMethod.PayAtCounter,
            PaymentStatus.Refunded));
        Assert.False(FrontCounterOrderPolicy.CanComplete(
            OrderStatus.Ready,
            PaymentMethod.PayAtCounter,
            PaymentStatus.Refunded));
        Assert.Equal(0m, FrontCounterOrderPolicy.AmountDue(
            42.50m,
            PaymentMethod.PayAtCounter,
            PaymentStatus.Refunded));
    }

    [Fact]
    public void CounterAmountDueExcludesSettledAndOnlineOrders()
    {
        Assert.Equal(42.50m, FrontCounterOrderPolicy.AmountDue(
            42.50m,
            PaymentMethod.PayAtCounter,
            PaymentStatus.Unpaid));
        Assert.Equal(0m, FrontCounterOrderPolicy.AmountDue(
            42.50m,
            PaymentMethod.PayAtCounter,
            PaymentStatus.PartiallyRefunded));
        Assert.Equal(0m, FrontCounterOrderPolicy.AmountDue(
            42.50m,
            PaymentMethod.Online,
            PaymentStatus.Pending));
    }
}
