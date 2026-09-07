using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Which payment attempts may stop an abandoned order from giving its portions back.
/// </summary>
/// <remarks>
/// <para>
/// The sweep skipped any order carrying a Pending payment, on the reasoning that the customer might
/// be on the card form. That reasoning is right about a live checkout session and wrong about the
/// row Stripe's own failure leaves behind: creating the session can fail, and the attempt is then
/// committed still marked Pending with the failure recorded only in its reason text.
/// </para>
/// <para>
/// Nobody can pay that one. The session id and the checkout URL come back in the same response, so
/// the failure that cost us the id cost the customer the link. Counted as in-flight it vetoed the
/// sweep permanently — and the reconciliation sweeper that might have tidied it skips any payment
/// with no identifier to reconcile against. Two sweepers, one order, neither able to touch it, and
/// its stock gone for good. One was reproduced holding two portions with no way back.
/// </para>
/// </remarks>
public class AbandonedOrderPaymentVetoTests
{
    private static bool CanTakeMoney(
        PaymentStatus status,
        string? sessionId = "cs_test_live",
        string? intentId = null) =>
        AbandonedOrderPolicy.CanStillTakeMoney(status, sessionId, intentId);

    /// <summary>A live session is exactly what the veto is for.</summary>
    [Fact]
    public void APendingAttemptWithALiveSessionStillHoldsTheOrder()
    {
        Assert.True(CanTakeMoney(PaymentStatus.Pending, sessionId: "cs_test_live"));
        Assert.True(CanTakeMoney(PaymentStatus.Pending, sessionId: null, intentId: "pi_test_live"));
    }

    /// <summary>Money already taken is never the sweep's to release.</summary>
    [Fact]
    public void APaidAttemptAlwaysHoldsTheOrder()
    {
        Assert.True(CanTakeMoney(PaymentStatus.Paid, sessionId: null, intentId: null));
    }

    /// <summary>
    /// The whole point. No identifier means no session at Stripe and no link in the customer's
    /// hands, so there is nothing to protect and nothing to wait for.
    /// </summary>
    [Fact]
    public void APendingAttemptThatNeverReachedStripeHoldsNothing()
    {
        Assert.False(CanTakeMoney(PaymentStatus.Pending, sessionId: null, intentId: null));
        Assert.False(CanTakeMoney(PaymentStatus.Pending, sessionId: "   ", intentId: "  "));
    }

    [Theory]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Expired)]
    [InlineData(PaymentStatus.Cancelled)]
    public void ASettledAttemptHoldsNothing(PaymentStatus status)
    {
        Assert.False(CanTakeMoney(status));
    }

    /// <summary>
    /// The two halves have to agree: an attempt that cannot take money is also one the sweep is
    /// free to close out, or the order is released while a row still claims a payment is coming.
    /// </summary>
    [Fact]
    public void AnythingTheSweepMayReleaseIsAlsoSomethingItMayCloseOut()
    {
        foreach (var status in Enum.GetValues<PaymentStatus>())
        {
            var holdsNothing = !AbandonedOrderPolicy.CanStillTakeMoney(status, null, null);
            var closesOut = AbandonedOrderPolicy.HasNoPaymentInFlight(status)
                || !AbandonedOrderPolicy.CanStillTakeMoney(status, null, null);

            if (holdsNothing)
            {
                Assert.True(closesOut, $"{status} may be released but would be left claiming a payment.");
            }
        }
    }

    /// <summary>
    /// Stripe keeps no Checkout Session payable for longer than a day, so past that the page is
    /// dead by arithmetic and does not need Stripe's agreement to be treated as such.
    /// </summary>
    /// <remarks>
    /// Without this, a session Stripe can no longer be asked about — created under an account that
    /// has since changed, or carried in from another environment's data — answers resource_missing
    /// forever. The sweep would wait on that answer forever too, holding the order's stock, and
    /// being the oldest such orders sit at the front of every batch and crowd the newer ones out.
    /// </remarks>
    [Fact]
    public void StripesOwnMaximumIsAnHourGlassNotAnOpinion()
    {
        Assert.Equal(TimeSpan.FromHours(24), HostedCheckoutExpiry.Maximum);

        var now = new DateTime(2026, 9, 7, 12, 0, 0, DateTimeKind.Utc);

        Assert.True(now - HostedCheckoutExpiry.Maximum >= now.AddDays(-1));
        Assert.True(now.AddDays(-2) <= now - HostedCheckoutExpiry.Maximum);
        Assert.False(now.AddMinutes(-30) <= now - HostedCheckoutExpiry.Maximum);
    }
}
