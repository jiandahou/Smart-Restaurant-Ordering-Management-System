using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The service existing is not the same as the cancel paths calling it, and there are four ways an
/// order stops: the customer cancels, staff cancel or reject it, or the sweeper gives up on it.
/// A hosted page left live by any one of them is chargeable for stock that has already gone back.
/// </summary>
public sealed class CancelledOrderExpiryWiringTests
{
    [Fact]
    public void ACustomerCancellationClosesTheHostedPage()
    {
        var body = Source("Controllers", "OrderController.cs");
        var expire = body.IndexOf("ExpireOpenSessionsAsync(order, \"customer-cancel\"", StringComparison.Ordinal);
        var release = body.IndexOf("_orderStockLedger.ReleaseAsync", StringComparison.Ordinal);

        Assert.True(expire >= 0, "Cancelling as a customer never expires the checkout session.");
        Assert.True(release > expire, "The stock goes back before the page stops being chargeable.");
    }

    [Fact]
    public void StaffCancellingOrRejectingClosesItToo()
    {
        var body = Source("Controllers", "AdminOrdersController.cs");
        var at = body.IndexOf("ExpireOpenSessionsAsync(", StringComparison.Ordinal);

        Assert.True(at >= 0, "The staff transition never expires the checkout session.");

        // Only on the transitions that stop the order. Expiring on Accept would kill a live payment.
        var guard = body[Math.Max(0, at - 400)..at];

        Assert.Contains("OrderStatus.Cancelled or OrderStatus.Rejected", guard, StringComparison.Ordinal);
    }

    /// <summary>
    /// The path staff use all day was the one path that closed an order without giving its portions
    /// back, and nothing downstream could catch it: the sweeper that releases abandoned orders only
    /// looks at Pending ones, so a rejected order held its stock permanently. Every order ever
    /// rejected on this deployment is still holding its portions.
    /// </summary>
    [Fact]
    public void StaffCancellingOrRejectingGivesTheStockBack()
    {
        var body = Source("Controllers", "AdminOrdersController.cs");
        var expire = body.IndexOf("ExpireOpenSessionsAsync(", StringComparison.Ordinal);
        var release = body.IndexOf("_orderStockLedger.ReleaseAsync", StringComparison.Ordinal);

        Assert.True(release >= 0, "Staff closing an order never gives its stock back.");
        Assert.True(release > expire, "The stock goes back before the page stops being chargeable.");
    }

    /// <summary>
    /// The other half of the same rule. Releasing on close is only correct if reopening takes the
    /// portions back, and refuses when they are gone — otherwise the fix trades a leak for an
    /// oversell, and the kitchen is handed an order it cannot make.
    /// </summary>
    [Fact]
    public void ReopeningTakesTheStockBackAndRefusesWhenItIsGone()
    {
        var body = Source("Controllers", "AdminOrdersController.cs");
        var reserve = body.IndexOf("_orderStockLedger.TryReserveAsync", StringComparison.Ordinal);

        Assert.True(reserve >= 0, "Reopening a closed order never re-reserves its stock.");

        var afterwards = body[reserve..Math.Min(body.Length, reserve + 900)];

        Assert.Contains("shortages.Count > 0", afterwards, StringComparison.Ordinal);
        Assert.Contains("RollbackAsync", afterwards, StringComparison.Ordinal);
    }

    [Fact]
    public void TheAbandonedOrderSweepClosesItBeforeReleasingTheStock()
    {
        var body = Source("Services", "AbandonedOrderExpiryService.cs");
        var expire = body.IndexOf("ExpireOpenSessionsAsync(", StringComparison.Ordinal);
        var release = body.IndexOf("stockLedger.ReleaseAsync", StringComparison.Ordinal);

        Assert.True(expire >= 0, "The sweep never expires the checkout session.");
        Assert.True(release > expire, "The stock goes back before the page stops being chargeable.");
    }

    /// <summary>
    /// Two things learn that a payment succeeded and they race: the browser returning to the success
    /// page asks the API to sync, and Stripe's webhook arrives on its own. Both reach the landing
    /// within a few hundred milliseconds. Only one refund is ever created — the processor's own
    /// guard answers the loser with a 409 — but recorded as a failure that guard produced an audit
    /// line saying the customer's money could not be returned, written while the refund returning it
    /// was in flight. That line is the one a person is meant to act on.
    /// </summary>
    [Fact]
    public void ASecondNoticeOfTheSamePaymentIsNotRecordedAsAFailedRefund()
    {
        var body = Source("Services", "OrderPaymentLanding.cs");
        var conflict = body.IndexOf("Status409Conflict", StringComparison.Ordinal);
        var alarm = body.IndexOf("PaymentAfterClosureRefundFailed", StringComparison.Ordinal);

        Assert.True(conflict >= 0, "A refund already under way is treated as a failure.");
        Assert.True(alarm > conflict, "The alarm is raised before the duplicate is ruled out.");
    }

    /// <summary>
    /// The deadline the customer is shown is twenty minutes. Reaching the payment screen quietly
    /// turned it into an hour: a created checkout session leaves the order Pending, and Pending was
    /// not a status the sweep collected — so nothing looked at the order again until Stripe expired
    /// the session on its own an hour later. One was measured still holding its portions at
    /// thirty-five minutes, with the sweep having passed it seventeen times.
    /// </summary>
    [Fact]
    public void TheSweepCollectsOrdersWhoseCheckoutSessionIsStillOpen()
    {
        var body = Source("Services", "AbandonedOrderExpiryService.cs");
        var filter = body.IndexOf("order.PaymentStatus == PaymentStatus.Cancelled", StringComparison.Ordinal);

        Assert.True(filter >= 0, "The candidate filter has moved; this test no longer reads it.");
        Assert.Contains(
            "order.PaymentStatus == PaymentStatus.Pending",
            body[filter..Math.Min(body.Length, filter + 800)],
            StringComparison.Ordinal);
    }

    /// <summary>
    /// Collecting them is only safe because Stripe gets the casting vote. A session that turns out
    /// to have been paid in the seconds the sweep spent deciding it had not, or a Stripe that
    /// cannot be reached at all, must leave the order exactly as it was — not release stock a live
    /// page can still be charged for.
    /// </summary>
    [Fact]
    public void NothingIsReleasedUntilStripeConfirmsThePageIsDead()
    {
        var body = Source("Services", "AbandonedOrderExpiryService.cs");
        var gate = body.IndexOf("closedSessions < liveSessions", StringComparison.Ordinal);
        var release = body.IndexOf("stockLedger.ReleaseAsync", StringComparison.Ordinal);

        Assert.True(gate >= 0, "The sweep releases without confirming the checkout page is closed.");
        Assert.True(release > gate, "The stock goes back before Stripe has confirmed anything.");
        Assert.Contains(
            "RollbackAsync",
            body[gate..Math.Min(body.Length, gate + 600)],
            StringComparison.Ordinal);
    }

    [Fact]
    public void TheServiceIsRegisteredOrNothingAbovePlugsIn()
    {
        Assert.Contains(
            "AddScoped<StripeCheckoutSessionExpiry>()",
            Source("", "Program.cs"),
            StringComparison.Ordinal);
    }

    private static string Source(string folder, string file)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);

        var path = folder.Length == 0
            ? Path.Combine(directory!.FullName, "DineFlow.Api", file)
            : Path.Combine(directory!.FullName, "DineFlow.Api", folder, file);

        return File.ReadAllText(path);
    }
}
