using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class RefundStatePolicyTests
{
    [Theory]
    [InlineData(PaymentRefundStatus.Pending)]
    [InlineData(PaymentRefundStatus.Succeeded)]
    [InlineData(PaymentRefundStatus.Failed)]
    public void PendingRefund_AcceptsAnyProviderStatus(PaymentRefundStatus incoming)
    {
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(PaymentRefundStatus.Pending, incoming));
    }

    [Theory]
    [InlineData(PaymentRefundStatus.Pending)]
    [InlineData(PaymentRefundStatus.Failed)]
    public void SucceededRefund_NeverRegresses(PaymentRefundStatus incoming)
    {
        Assert.False(RefundStatePolicy.CanApplyProviderStatus(PaymentRefundStatus.Succeeded, incoming));
    }

    [Fact]
    public void SucceededRefund_StaysSucceededOnReplay()
    {
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Succeeded,
            PaymentRefundStatus.Succeeded));
    }

    [Fact]
    public void FailedRefund_AcceptsLaterSuccessBecauseStripeIsAuthoritative()
    {
        // We mark refunds failed when the Stripe call throws, including on timeouts where the
        // refund may actually have gone through.
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Failed,
            PaymentRefundStatus.Succeeded));
    }

    [Fact]
    public void FailedRefund_DoesNotSlideBackToPending()
    {
        Assert.False(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Failed,
            PaymentRefundStatus.Pending));
    }
}
