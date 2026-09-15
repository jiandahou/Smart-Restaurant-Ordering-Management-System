using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An order the restaurant turned away that is still holding the customer's money.
/// </summary>
/// <remarks>
/// <para>
/// It happens two ways and both were invisible. A refund can fail, and a payment can land after the
/// decision — cancelling asks Stripe to close the checkout page, that request can fail, and the
/// customer with the tab still open pays for an order that no longer exists.
/// </para>
/// <para>
/// Either way the order left every working queue the moment it closed, and a payment hold had to be
/// live to count, so it appeared on no screen at all. One was found only by reading a log line.
/// </para>
/// </remarks>
public class UnsettledClosureQueueTests
{
    private static readonly DateTime Now = new(2026, 9, 7, 12, 0, 0, DateTimeKind.Utc);

    private static bool InQueue(
        string queue,
        OrderStatus status,
        PaymentStatus paymentStatus,
        PaymentMethod method = PaymentMethod.Online) =>
        StaffOrderQueue.Matches(queue, status, paymentStatus, method, Now.AddMinutes(-5), Now);

    [Theory]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void MoneyLeftOnATurnedAwayOrderIsAPaymentHold(OrderStatus status)
    {
        Assert.True(StaffOrderQueue.IsUnsettledClosure(status, PaymentStatus.Paid, PaymentMethod.Online));
        Assert.True(InQueue("payment", status, PaymentStatus.Paid));
    }

    /// <summary>A partial refund still leaves money behind, so it is the same problem.</summary>
    [Fact]
    public void APartiallyRefundedClosureStillCounts()
    {
        Assert.True(InQueue("payment", OrderStatus.Rejected, PaymentStatus.PartiallyRefunded));
    }

    /// <summary>The refund landed. There is nothing left for anyone to do.</summary>
    [Theory]
    [InlineData(PaymentStatus.Refunded)]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.Expired)]
    public void ASettledClosureIsNotAHold(PaymentStatus paymentStatus)
    {
        Assert.False(InQueue("payment", OrderStatus.Rejected, paymentStatus));
    }

    /// <summary>Keeping the money is the whole point of a completed order.</summary>
    [Fact]
    public void ACompletedOrderIsNeverAnUnsettledClosure()
    {
        Assert.False(StaffOrderQueue.IsUnsettledClosure(
            OrderStatus.Completed, PaymentStatus.Paid, PaymentMethod.Online));
        Assert.False(InQueue("payment", OrderStatus.Completed, PaymentStatus.Paid));
    }

    /// <summary>
    /// Counter money never came through the platform, so there is nothing here to send back — the
    /// restaurant hands it over at the till, or never took it.
    /// </summary>
    [Fact]
    public void ACounterOrderIsNotAnUnsettledClosure()
    {
        Assert.False(InQueue("payment", OrderStatus.Rejected, PaymentStatus.Paid, PaymentMethod.PayAtCounter));
    }

    /// <summary>
    /// It is finished work with something outstanding, so it belongs in both — and in none of the
    /// queues that describe what the kitchen is cooking.
    /// </summary>
    [Fact]
    public void ItShowsInClosedAsWellAndInNoWorkingQueue()
    {
        Assert.True(InQueue("closed", OrderStatus.Rejected, PaymentStatus.Paid));

        foreach (var queue in new[] { "active", "new", "kitchen", "ready", "late", "carried" })
        {
            Assert.False(InQueue(queue, OrderStatus.Rejected, PaymentStatus.Paid));
        }
    }
}
