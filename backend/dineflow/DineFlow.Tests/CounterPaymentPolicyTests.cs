using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public class CounterPaymentPolicyTests
{
    [Theory]
    [InlineData(PaymentProviders.Counter, true)]
    [InlineData(PaymentProviders.CounterCash, true)]
    [InlineData(PaymentProviders.CounterCard, true)]
    [InlineData(PaymentProviders.Stripe, false)]
    [InlineData(null, false)]
    public void OnlyCounterProvidersAreInScope(string? provider, bool expected)
    {
        Assert.Equal(expected, CounterPaymentPolicy.IsCounterPayment(provider));
    }

    [Fact]
    public void UntouchedCounterPayment_CanBeVoided()
    {
        Assert.True(CounterPaymentPolicy.CanVoid(
            PaymentProviders.CounterCash,
            PaymentStatus.Paid,
            hasAnyRefund: false,
            voidedAt: null));
    }

    [Fact]
    public void PaymentWithARefund_CannotBeVoided()
    {
        // Once money has moved back, the honest record is another refund, not erasing the sale.
        Assert.False(CounterPaymentPolicy.CanVoid(
            PaymentProviders.CounterCash,
            PaymentStatus.Paid,
            hasAnyRefund: true,
            voidedAt: null));
    }

    [Fact]
    public void AlreadyVoidedPayment_CannotBeVoidedAgain()
    {
        Assert.False(CounterPaymentPolicy.CanVoid(
            PaymentProviders.CounterCash,
            PaymentStatus.Paid,
            hasAnyRefund: false,
            voidedAt: DateTime.UtcNow));
    }

    [Fact]
    public void StripePayment_IsNeverVoidedThroughTheCounterPath()
    {
        Assert.False(CounterPaymentPolicy.CanVoid(
            PaymentProviders.Stripe,
            PaymentStatus.Paid,
            hasAnyRefund: false,
            voidedAt: null));
    }

    [Theory]
    [InlineData(PaymentStatus.Paid, true)]
    [InlineData(PaymentStatus.PartiallyRefunded, true)]
    [InlineData(PaymentStatus.Refunded, false)]
    [InlineData(PaymentStatus.Cancelled, false)]
    [InlineData(PaymentStatus.Pending, false)]
    public void OfflineRefund_RequiresCollectedMoneyStillOutstanding(PaymentStatus status, bool expected)
    {
        Assert.Equal(
            expected,
            CounterPaymentPolicy.CanOfflineRefund(PaymentProviders.CounterCash, status, voidedAt: null));
    }

    [Fact]
    public void VoidedPayment_CannotAlsoBeRefunded()
    {
        Assert.False(CounterPaymentPolicy.CanOfflineRefund(
            PaymentProviders.CounterCash,
            PaymentStatus.Paid,
            voidedAt: DateTime.UtcNow));
    }

    [Theory]
    [InlineData(1000, 1000, true)]
    [InlineData(999, 1000, true)]
    [InlineData(1001, 1000, false)]
    [InlineData(0, 1000, false)]
    [InlineData(-1, 1000, false)]
    public void RefundAmount_MustFitTheRemainingBalance(long amount, long refundable, bool expected)
    {
        Assert.Equal(expected, CounterPaymentPolicy.IsValidRefundAmount(amount, refundable));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("Customer changed their mind", true)]
    public void ReasonIsMandatory(string? reason, bool expected)
    {
        // The reason is the only audit control on an act the system cannot verify.
        Assert.Equal(expected, CounterPaymentPolicy.IsValidReason(reason));
    }

    [Fact]
    public void OverlongReasonIsRejected()
    {
        Assert.False(CounterPaymentPolicy.IsValidReason(new string('x', 1_001)));
    }
}
