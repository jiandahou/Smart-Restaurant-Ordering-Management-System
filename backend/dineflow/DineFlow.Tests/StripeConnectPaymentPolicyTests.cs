using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class StripeConnectPaymentPolicyTests
{
    [Theory]
    [InlineData(1_000, 0, 0)]
    [InlineData(1_000, 250, 25)]
    [InlineData(1_001, 250, 25)]
    [InlineData(1_020, 250, 26)]
    [InlineData(10_000, 1_000, 1_000)]
    public void OrderPlatformFee_UsesBasisPointsAndRoundsToCents(
        long amountCents,
        int feeBasisPoints,
        long expectedFeeCents)
    {
        Assert.Equal(
            expectedFeeCents,
            PlatformFeeCalculator.CalculateOrderFee(amountCents, feeBasisPoints));
    }

    [Fact]
    public void OrderPlatformFee_NeverConsumesTheWholeCharge()
    {
        Assert.Equal(99, PlatformFeeCalculator.CalculateOrderFee(100, 10_000));
    }

    [Theory]
    [InlineData(PaymentStatus.Paid, PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Paid, PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Refunded, PaymentStatus.Paid)]
    [InlineData(PaymentStatus.PartiallyRefunded, PaymentStatus.Failed)]
    public void ProviderStatus_DoesNotRegressSettledPayments(
        PaymentStatus current,
        PaymentStatus incoming)
    {
        Assert.False(PaymentStatePolicy.CanApplyProviderStatus(current, incoming));
    }

    [Theory]
    [InlineData(PaymentStatus.Pending, PaymentStatus.Paid)]
    [InlineData(PaymentStatus.Failed, PaymentStatus.Paid)]
    [InlineData(PaymentStatus.Expired, PaymentStatus.Paid)]
    public void ProviderStatus_AllowsAConfirmedPaymentToRecoverEarlierFailures(
        PaymentStatus current,
        PaymentStatus incoming)
    {
        Assert.True(PaymentStatePolicy.CanApplyProviderStatus(current, incoming));
    }
}
