using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

public static class RefundRequestClaimPolicy
{
    /// How long a Processing claim may sit before another reviewer can take it over. Long enough
    /// that a slow-but-live Stripe call is never stolen mid-flight.
    public static readonly TimeSpan StaleClaimAge = TimeSpan.FromMinutes(10);

    /// A claim is only reclaimable when it is still Processing, never produced a refund, and has
    /// not been touched since the cutoff. Requiring a null refund id is what makes this safe: once
    /// money has moved the request can never be reclaimed.
    public static bool IsStaleClaim(
        PaymentRefundRequestStatus status,
        Guid? paymentRefundId,
        DateTime? updatedAt,
        DateTime reclaimableBefore) =>
        status == PaymentRefundRequestStatus.Processing
        && paymentRefundId is null
        && updatedAt.HasValue
        && updatedAt.Value < reclaimableBefore;
}
