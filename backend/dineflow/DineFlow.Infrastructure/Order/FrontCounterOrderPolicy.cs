using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public static class FrontCounterOrderPolicy
{
    // Completed is intentionally allowed, matching OrderPaymentEligibility.CanSettleAtCounter: a
    // pay-at-counter customer who eats first and pays on the way out is the ordinary case, and a
    // completed order whose counter payment was voided for a tender correction (cash keyed by
    // mistake, then re-charged to card) still has money outstanding to record (AUDIT-04). The real
    // gate is IsCounterPaymentDue — a completed order that is already paid has nothing due, so this
    // stays false for it and cannot double-charge. Cancelled and rejected orders are never chargeable.
    public static bool CanRecordCounterPayment(
        OrderStatus orderStatus,
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus) =>
        orderStatus is not OrderStatus.Cancelled
            and not OrderStatus.Rejected
        && OrderPaymentEligibility.IsCounterPaymentDue(paymentMethod, paymentStatus);

    public static bool CanComplete(
        OrderStatus orderStatus,
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus) =>
        orderStatus == OrderStatus.Ready
        && OrderPaymentEligibility.IsSettledForFulfillment(paymentStatus);

    public static decimal AmountDue(
        decimal totalAmount,
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus) =>
        OrderPaymentEligibility.IsCounterPaymentDue(paymentMethod, paymentStatus)
            ? totalAmount
            : 0m;
}
