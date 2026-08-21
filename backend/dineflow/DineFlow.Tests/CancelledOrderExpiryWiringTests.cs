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
        var release = body.IndexOf("_menuItemStockService.ReleaseAsync", StringComparison.Ordinal);

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

    [Fact]
    public void TheAbandonedOrderSweepClosesItBeforeReleasingTheStock()
    {
        var body = Source("Services", "AbandonedOrderExpiryService.cs");
        var expire = body.IndexOf("ExpireOpenSessionsAsync(", StringComparison.Ordinal);
        var release = body.IndexOf("stockService.ReleaseAsync", StringComparison.Ordinal);

        Assert.True(expire >= 0, "The sweep never expires the checkout session.");
        Assert.True(release > expire, "The stock goes back before the page stops being chargeable.");
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
