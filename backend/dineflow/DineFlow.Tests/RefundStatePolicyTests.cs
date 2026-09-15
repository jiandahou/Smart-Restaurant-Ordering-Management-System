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

    /// <summary>
    /// A succeeded refund never slides back to pending. Ordering is not guaranteed, and a late
    /// refund.created must not undo a refund that has gone through.
    /// </summary>
    [Fact]
    public void SucceededRefund_NeverSlidesBackToPending()
    {
        Assert.False(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Succeeded,
            PaymentRefundStatus.Pending));
    }

    /// <summary>
    /// It does, however, accept a later failure.
    /// </summary>
    /// <remarks>
    /// This test used to assert the opposite, and in asserting it, kept a real defect in place:
    /// Stripe calls a refund succeeded once it has sent the money on, and the customer's bank can
    /// reject it days later. Refusing that refund.failed left the record claiming a customer had been
    /// refunded when they had not, with the refundable balance spent so nobody could try again.
    /// Ordering is handled by the refund's own provider event clock, not by refusing the provider's
    /// own correction.
    /// </remarks>
    [Fact]
    public void SucceededRefund_AcceptsALaterFailureBecauseStripeIsAuthoritative()
    {
        Assert.True(RefundStatePolicy.CanApplyProviderStatus(
            PaymentRefundStatus.Succeeded,
            PaymentRefundStatus.Failed));
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
