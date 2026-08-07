using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class RefundRequestClaimPolicyTests
{
    private static readonly DateTime Now = new(2026, 7, 31, 12, 0, 0, DateTimeKind.Utc);
    private static DateTime ReclaimableBefore => Now - RefundRequestClaimPolicy.StaleClaimAge;

    [Fact]
    public void AbandonedProcessingClaim_BecomesReclaimable()
    {
        Assert.True(RefundRequestClaimPolicy.IsStaleClaim(
            PaymentRefundRequestStatus.Processing,
            paymentRefundId: null,
            updatedAt: Now - TimeSpan.FromHours(2),
            ReclaimableBefore));
    }

    [Fact]
    public void FreshProcessingClaim_IsNotStolenMidFlight()
    {
        Assert.False(RefundRequestClaimPolicy.IsStaleClaim(
            PaymentRefundRequestStatus.Processing,
            paymentRefundId: null,
            updatedAt: Now - TimeSpan.FromSeconds(30),
            ReclaimableBefore));
    }

    [Fact]
    public void ClaimThatAlreadyMovedMoney_IsNeverReclaimable()
    {
        // The null-refund-id requirement is the safety property: once a refund exists, no second
        // reviewer may re-run the approval no matter how old the claim is.
        Assert.False(RefundRequestClaimPolicy.IsStaleClaim(
            PaymentRefundRequestStatus.Processing,
            paymentRefundId: Guid.NewGuid(),
            updatedAt: Now - TimeSpan.FromDays(7),
            ReclaimableBefore));
    }

    [Theory]
    [InlineData(PaymentRefundRequestStatus.Pending)]
    [InlineData(PaymentRefundRequestStatus.Approved)]
    [InlineData(PaymentRefundRequestStatus.Rejected)]
    [InlineData(PaymentRefundRequestStatus.Cancelled)]
    public void NonProcessingStatuses_AreNotStaleClaims(PaymentRefundRequestStatus status)
    {
        Assert.False(RefundRequestClaimPolicy.IsStaleClaim(
            status,
            paymentRefundId: null,
            updatedAt: Now - TimeSpan.FromDays(1),
            ReclaimableBefore));
    }

    [Fact]
    public void ClaimWithNoTimestamp_IsNotReclaimable()
    {
        Assert.False(RefundRequestClaimPolicy.IsStaleClaim(
            PaymentRefundRequestStatus.Processing,
            paymentRefundId: null,
            updatedAt: null,
            ReclaimableBefore));
    }
}
