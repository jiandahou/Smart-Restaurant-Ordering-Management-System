using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Platform revenue was one <c>Sum</c> over every paid order regardless of currency, which the
/// dashboard then formatted with whichever currency the first active restaurant used. AUD 325.50 +
/// INR 616.00 + NPR 1113.00 rendered as "A$2054.50" — a number that is not revenue in any currency.
/// </summary>
public sealed class AdminOrderRevenueTests
{
    [Fact]
    public void TheSummaryGroupsRevenueByCurrencyRatherThanSummingAcrossIt()
    {
        var body = SummaryAction();

        Assert.Contains("GroupBy(order => order.Restaurant!.Currency)", body, StringComparison.Ordinal);
    }

    [Fact]
    public void NoSingleRevenueFigureIsProduced()
    {
        // A combined total needs an exchange rate, and this platform holds none.
        Assert.DoesNotContain(
            "Revenue = group\n                    .Where(order => order.PaymentStatus == PaymentStatus.Paid)",
            SummaryAction(),
            StringComparison.Ordinal);
    }

    /// <summary>
    /// Revenue is money that completed, net of what went back.
    /// </summary>
    /// <remarks>
    /// This read <c>Sum(order => order.TotalAmount)</c> over orders that were exactly <c>Paid</c>,
    /// which is the behaviour that dropped a whole A$26.61 order out of the day's takings the moment
    /// A$1 of it was refunded. The rule now lives in <c>OrderRevenuePolicy</c> and is inlined into the
    /// query because it has to run as SQL, so what is checked here is that the inlining still says the
    /// same thing.
    /// </remarks>
    [Fact]
    public void RevenueIsSettledMoneyLessWhatWasRefunded()
    {
        var body = SummaryAction();
        var grouping = body[body.IndexOf("GroupBy(order => order.Restaurant!.Currency)", StringComparison.Ordinal)..];
        var filter = body[..body.IndexOf("GroupBy(order => order.Restaurant!.Currency)", StringComparison.Ordinal)];

        // The settled set, matching OrderRevenuePolicy.IsSettled.
        Assert.Contains("PaymentStatus == PaymentStatus.Paid", filter, StringComparison.Ordinal);
        Assert.Contains("PaymentStatus == PaymentStatus.PartiallyRefunded", filter, StringComparison.Ordinal);
        Assert.Contains("PaymentStatus == PaymentStatus.Refunded", filter, StringComparison.Ordinal);

        Assert.Contains("Sum(order =>", grouping, StringComparison.Ordinal);
        Assert.Contains("order.TotalAmount", grouping, StringComparison.Ordinal);
        // Only refunds that actually went through come off the takings.
        Assert.Contains("PaymentRefundStatus.Succeeded", grouping, StringComparison.Ordinal);
        Assert.Contains("Sum(refund => refund.AmountCents) / 100m", grouping, StringComparison.Ordinal);
    }

    [Fact]
    public void TheContractCarriesACurrencyWithEveryAmount()
    {
        var contract = File.ReadAllText(Path.Combine(RepositoryRoot(), "DineFlow.Api", "Contracts", "Order", "AdminOrderSummaryResponse.cs"));

        Assert.Contains("class AdminOrderRevenueResponse", contract, StringComparison.Ordinal);
        Assert.Contains("string Currency", contract, StringComparison.Ordinal);
        Assert.Contains("IReadOnlyList<AdminOrderRevenueResponse> Revenue", contract, StringComparison.Ordinal);
    }

    private static string SummaryAction()
    {
        var source = File.ReadAllText(Path.Combine(
            RepositoryRoot(), "DineFlow.Api", "Controllers", "AdminOrdersController.cs"));
        var start = source.IndexOf("var summary = await query", StringComparison.Ordinal);

        Assert.True(start >= 0, "Could not find the summary query — has it been renamed?");

        var end = source.IndexOf("\n    [Http", start, StringComparison.Ordinal);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
