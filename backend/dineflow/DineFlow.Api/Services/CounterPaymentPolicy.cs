using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <summary>
/// Rules for reversing money taken at the counter.
///
/// Unlike a Stripe refund, none of this can be verified by a provider — the system is only
/// recording that a human handed cash back or ran a terminal refund. That makes the audit trail
/// the only control, so every path here demands a reason and an actor.
/// </summary>
public static class CounterPaymentPolicy
{
    public static bool IsCounterPayment(string? provider) =>
        provider is PaymentProviders.Counter
            or PaymentProviders.CounterCash
            or PaymentProviders.CounterCard;

    /// A void says the payment should never have been taken, so it is only available while the
    /// payment is untouched — once any money has been refunded against it, the correct record is
    /// another refund, not a rewrite of history.
    public static bool CanVoid(string? provider, PaymentStatus status, bool hasAnyRefund, DateTime? voidedAt) =>
        IsCounterPayment(provider)
        && status == PaymentStatus.Paid
        && !hasAnyRefund
        && voidedAt is null;

    public static bool CanOfflineRefund(string? provider, PaymentStatus status, DateTime? voidedAt) =>
        IsCounterPayment(provider)
        && status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded
        && voidedAt is null;

    public static bool IsValidRefundAmount(long amountCents, long refundableAmountCents) =>
        amountCents > 0 && amountCents <= refundableAmountCents;

    /// The reason is the only thing standing between this and an untraceable cash withdrawal.
    public static bool IsValidReason(string? reason) =>
        !string.IsNullOrWhiteSpace(reason) && reason.Trim().Length <= 1_000;
}
