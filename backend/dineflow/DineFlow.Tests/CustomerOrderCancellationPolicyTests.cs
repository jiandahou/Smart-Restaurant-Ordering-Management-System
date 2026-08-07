using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class CustomerOrderCancellationPolicyTests
{
    [Theory]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.NotRequired)]
    public void PendingOrder_WithNoActiveOrSettledPayment_CanBeCancelled(PaymentStatus paymentStatus)
    {
        Assert.True(CustomerOrderCancellationPolicy.CanCancel(OrderStatus.Pending, paymentStatus));
    }

    [Theory]
    [InlineData(PaymentStatus.Pending)]
    [InlineData(PaymentStatus.Paid)]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.Refunded)]
    public void PendingOrder_WithActiveOrSettledPayment_CannotBeCancelled(PaymentStatus paymentStatus)
    {
        Assert.False(CustomerOrderCancellationPolicy.CanCancel(OrderStatus.Pending, paymentStatus));
    }

    [Theory]
    [InlineData(OrderStatus.Accepted)]
    [InlineData(OrderStatus.Preparing)]
    [InlineData(OrderStatus.Ready)]
    [InlineData(OrderStatus.Completed)]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void OnceOrderLeavesPending_CustomerCannotCancel(OrderStatus orderStatus)
    {
        Assert.False(CustomerOrderCancellationPolicy.CanCancel(orderStatus, PaymentStatus.Unpaid));
    }
}
