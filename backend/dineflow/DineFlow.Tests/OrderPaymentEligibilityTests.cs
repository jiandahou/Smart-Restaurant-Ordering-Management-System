using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class OrderPaymentEligibilityTests
{
    [Theory]
    [InlineData(PaymentStatus.Paid)]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.NotRequired)]
    public void SettledStatuses_AreEligibleForFulfillment(PaymentStatus status)
    {
        Assert.True(OrderPaymentEligibility.IsSettledForFulfillment(status));
        Assert.True(OrderPaymentEligibility.CanProcess(PaymentMethod.Online, status));
    }

    [Theory]
    [InlineData(PaymentStatus.Pending)]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.Expired)]
    public void OnlinePaymentProblems_ArePayableButNotFulfillmentEligible(PaymentStatus status)
    {
        Assert.True(OrderPaymentEligibility.IsPayableOnlineStatus(status));
        Assert.False(OrderPaymentEligibility.CanProcess(PaymentMethod.Online, status));
    }

    [Fact]
    public void FullyRefundedOrder_IsNeitherPayableNorFulfillmentEligible()
    {
        Assert.False(OrderPaymentEligibility.IsPayableOnlineStatus(PaymentStatus.Refunded));
        Assert.False(OrderPaymentEligibility.CanProcess(PaymentMethod.Online, PaymentStatus.Refunded));
        Assert.False(OrderPaymentEligibility.CanProcess(PaymentMethod.PayAtCounter, PaymentStatus.Refunded));
    }

    [Fact]
    public void CounterPaymentOrder_RemainsEligibleForKitchenProcessing()
    {
        Assert.True(OrderPaymentEligibility.CanProcess(PaymentMethod.PayAtCounter, PaymentStatus.Unpaid));
    }
}
