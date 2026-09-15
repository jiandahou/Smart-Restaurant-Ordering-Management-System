using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

using OrderEntity = DineFlow.Infrastructure.Orders.Order;

namespace DineFlow.Tests;

/// <summary>
/// Rejecting a paid order and refunding it were two separate things a member of staff had to
/// remember, and the second is the one nobody remembers: every paid order rejected on this
/// deployment had been rejected and never refunded — money gone, no food, order marked Rejected.
///
/// <para>
/// The rule restored here is one the codebase already held. A restaurant that closes without
/// accepting an order has its orders refunded automatically, because "nobody is coming to accept it,
/// so holding the customer's money serves no one". Staff pressing reject is that same situation
/// stated out loud, and was the single case where the money stayed.
/// </para>
/// </summary>
public class TurnedAwayOrderRefundTests
{
    private static OrderEntity Order(
        PaymentStatus paymentStatus,
        PaymentMethod method = PaymentMethod.Online,
        params Payment[] payments)
    {
        var order = new OrderEntity
        {
            Id = Guid.NewGuid(),
            OrderNumber = "ORD-1",
            PaymentStatus = paymentStatus,
            PaymentMethod = method,
        };

        foreach (var payment in payments)
        {
            order.Payments.Add(payment);
        }

        return order;
    }

    private static Payment Paid(long amountCents, params PaymentRefund[] refunds)
    {
        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            Status = PaymentStatus.Paid,
            AmountCents = amountCents,
            Provider = PaymentProviders.Stripe,
        };

        foreach (var refund in refunds)
        {
            payment.Refunds.Add(refund);
        }

        return payment;
    }

    private static PaymentRefund Refund(long amountCents, PaymentRefundStatus status = PaymentRefundStatus.Succeeded) =>
        new() { Id = Guid.NewGuid(), AmountCents = amountCents, Status = status };

    [Fact]
    public void APaidOrderOwesItAllBack()
    {
        var order = Order(PaymentStatus.Paid, PaymentMethod.Online, Paid(950));

        Assert.Equal(950, TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>Only what is left: an earlier partial refund has already gone back.</summary>
    [Fact]
    public void APartlyRefundedOrderOwesTheRemainder()
    {
        var order = Order(PaymentStatus.PartiallyRefunded, PaymentMethod.Online, Paid(2_550, Refund(1_000)));

        Assert.Equal(1_550, TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>A refund that never went through has given nothing back.</summary>
    [Fact]
    public void AFailedRefundDoesNotCountAsMoneyReturned()
    {
        var order = Order(
            PaymentStatus.Paid,
            PaymentMethod.Online,
            Paid(950, Refund(950, PaymentRefundStatus.Failed)));

        Assert.Equal(950, TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    [Fact]
    public void AFullyRefundedOrderOwesNothing()
    {
        var order = Order(PaymentStatus.PartiallyRefunded, PaymentMethod.Online, Paid(950, Refund(950)));

        Assert.Null(TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    [Fact]
    public void AnUnpaidOrderOwesNothing()
    {
        var order = Order(PaymentStatus.Unpaid, PaymentMethod.Online);

        Assert.Null(TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>
    /// The order's own summary field disagreeing with its payments must not be able to hide money.
    /// </summary>
    /// <remarks>
    /// This is the shape that goes unnoticed: a cancellation writes Cancelled across the order while
    /// a charge succeeds underneath it. Asking the summary first answered "nothing owed", so nothing
    /// offered to refund it and no screen raised it — the customer had paid, been turned away, and
    /// disappeared. The payments are the ledger; the summary is a cache of them.
    /// </remarks>
    [Theory]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Pending)]
    public void MoneyTakenIsOwedBackEvenWhenTheOrderSaysItWasNot(PaymentStatus orderSays)
    {
        var order = Order(orderSays, PaymentMethod.Online, Paid(2_550));

        Assert.Equal(2_550, TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>
    /// And the same rule pointing the other way: the summary cannot invent money either. A checkout
    /// that never charged owes nothing, whatever the order believes about itself.
    /// </summary>
    [Fact]
    public void APaymentThatNeverWentThroughOwesNothingEvenWhenTheOrderSaysPaid()
    {
        var expired = new Payment
        {
            Id = Guid.NewGuid(),
            Status = PaymentStatus.Expired,
            AmountCents = 2_550,
            Provider = PaymentProviders.Stripe,
        };
        var order = Order(PaymentStatus.Paid, PaymentMethod.Online, expired);

        Assert.Null(TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>Two charges on one order owe the sum of what is left on both.</summary>
    [Fact]
    public void EveryPaymentCounts()
    {
        var order = Order(PaymentStatus.Paid, PaymentMethod.Online, Paid(950), Paid(2_550, Refund(1_000)));

        Assert.Equal(950 + 1_550, TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>
    /// Counter payments are settled in cash at the till, so the platform has nothing to send back.
    /// Attempting one would ask Stripe to refund money it never took.
    /// </summary>
    [Fact]
    public void ACounterOrderIsSettledAtTheTillNotThroughStripe()
    {
        var order = Order(PaymentStatus.Paid, PaymentMethod.PayAtCounter, Paid(950));

        Assert.Null(TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false));
    }

    /// <summary>
    /// A customer cancelling their own order has its own policy — a refund window with conditions.
    /// Re-deciding it here would hand back money the policy says stays.
    /// </summary>
    [Fact]
    public void ACustomersOwnCancellationIsNotThisRule()
    {
        var order = Order(PaymentStatus.Paid, PaymentMethod.Online, Paid(950));

        Assert.Null(TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: true));
    }

    /// <summary>
    /// The customer reads this on a bank statement. A staff member's own note — "duplicate order" —
    /// explains nothing to the person holding the phone.
    /// </summary>
    [Theory]
    [InlineData(OrderStatus.Rejected, "could not accept")]
    [InlineData(OrderStatus.Cancelled, "cancelled")]
    public void TheCustomerIsToldWhatHappenedInTheirOwnTerms(OrderStatus closedAs, string expected)
    {
        Assert.Contains(expected, TurnedAwayOrderRefund.CustomerExplanation(closedAs), StringComparison.OrdinalIgnoreCase);
    }
}
