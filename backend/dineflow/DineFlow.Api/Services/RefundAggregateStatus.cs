using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <summary>
/// What a payment's status is, given how much of it has actually been refunded.
/// </summary>
/// <remarks>
/// <para>
/// Derived from the refunds that succeeded, and only those. This used to treat
/// <see cref="PaymentStatus.Refunded"/> as terminal — once fully refunded, never anything else — on
/// the reasoning that out-of-order webhooks can briefly make the refunded total look too low. But a
/// refund that fails after having succeeded makes that total genuinely lower, permanently, and the
/// payment then sat at Refunded with nothing refundable left. The customer had their money taken and
/// not returned, and staff could not retry because the system believed it had already gone back.
/// </para>
/// <para>
/// Ordering is not this rule's job. Each refund's own state is guarded by its provider event clock
/// and <see cref="RefundStatePolicy"/>; this only has to add up what those left behind, honestly.
/// </para>
/// </remarks>
public static class RefundAggregateStatus
{
    public static PaymentStatus Resolve(
        PaymentStatus current,
        long paymentAmountCents,
        long succeededRefundCents)
    {
        if (paymentAmountCents > 0 && succeededRefundCents >= paymentAmountCents)
        {
            return PaymentStatus.Refunded;
        }

        if (succeededRefundCents > 0)
        {
            return PaymentStatus.PartiallyRefunded;
        }

        // Nothing was refunded after all. The payment stands, and its whole value is refundable
        // again — which is what lets someone try the refund a second time.
        return current is PaymentStatus.Refunded or PaymentStatus.PartiallyRefunded
            ? PaymentStatus.Paid
            : current;
    }
}
