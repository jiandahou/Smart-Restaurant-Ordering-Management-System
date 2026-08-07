using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public static class CustomerOrderCancellationPolicy
{
    public static bool CanCancel(OrderStatus orderStatus, PaymentStatus paymentStatus) =>
        orderStatus == OrderStatus.Pending
        && paymentStatus is PaymentStatus.Unpaid
            or PaymentStatus.Failed
            or PaymentStatus.Expired
            or PaymentStatus.Cancelled
            or PaymentStatus.NotRequired;
}
