using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

public static class RefundStatePolicy
{
    public static bool CanApplyProviderStatus(PaymentRefundStatus current, PaymentRefundStatus incoming) =>
        current switch
        {
            // Money is confirmed moved. Stripe does not guarantee webhook ordering, so a late
            // refund.created must never walk a succeeded refund back to pending.
            PaymentRefundStatus.Succeeded => incoming == PaymentRefundStatus.Succeeded,

            // We mark a refund failed when the Stripe call throws — including on a timeout, where
            // Stripe may actually have processed it. A later success is therefore authoritative and
            // must be allowed through; sliding back to pending must not.
            PaymentRefundStatus.Failed =>
                incoming is PaymentRefundStatus.Failed or PaymentRefundStatus.Succeeded,

            _ => true
        };
}
