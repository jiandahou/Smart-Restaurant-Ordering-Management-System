using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public static class OrderPaymentEligibility
{
    public static bool IsSettledForFulfillment(PaymentStatus status) =>
        status is PaymentStatus.Paid
            or PaymentStatus.PartiallyRefunded
            or PaymentStatus.NotRequired;

    public static bool CanProcess(PaymentMethod method, PaymentStatus status) =>
        status != PaymentStatus.Refunded
        && (method == PaymentMethod.PayAtCounter || IsSettledForFulfillment(status));

    public static bool IsPayableOnlineStatus(PaymentStatus status) =>
        status is PaymentStatus.Pending
            or PaymentStatus.Unpaid
            or PaymentStatus.Failed
            or PaymentStatus.Cancelled
            or PaymentStatus.Expired;

    public static bool IsCounterPaymentDue(PaymentMethod method, PaymentStatus status) =>
        method == PaymentMethod.PayAtCounter && IsPayableOnlineStatus(status);
}
