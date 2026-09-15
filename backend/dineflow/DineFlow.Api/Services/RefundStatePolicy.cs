using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

public static class RefundStatePolicy
{
    public static bool CanApplyProviderStatus(PaymentRefundStatus current, PaymentRefundStatus incoming) =>
        current switch
        {
            // A refund that has succeeded can still fail afterwards. Stripe returns "succeeded" as
            // soon as it has sent the money on, and the customer's bank can reject it days later —
            // Stripe then raises refund.failed and returns the funds to the platform balance. Refusing
            // that event left the record saying the customer had been refunded when they had not,
            // with no failure reason and the refundable balance still spent, so nobody could even
            // try again. The refund is the one thing in the system that is only ever true because the
            // provider says so, and this is the provider saying otherwise.
            //
            // A late refund.created must still not walk a succeeded refund back to pending: ordering
            // is handled by the refund's own provider event clock, which drops anything older than
            // what has already been applied, and pending is refused here regardless.
            PaymentRefundStatus.Succeeded =>
                incoming is PaymentRefundStatus.Succeeded or PaymentRefundStatus.Failed,

            // We mark a refund failed when the Stripe call throws — including on a timeout, where
            // Stripe may actually have processed it. A later success is therefore authoritative and
            // must be allowed through; sliding back to pending must not.
            PaymentRefundStatus.Failed =>
                incoming is PaymentRefundStatus.Failed or PaymentRefundStatus.Succeeded,

            _ => true
        };
}
