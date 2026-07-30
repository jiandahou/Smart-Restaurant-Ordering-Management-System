using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public static class FrontCounterOrderPolicy
{
    public static bool CanRecordCounterPayment(
        OrderStatus orderStatus,
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus) =>
        orderStatus is not OrderStatus.Completed
            and not OrderStatus.Cancelled
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
