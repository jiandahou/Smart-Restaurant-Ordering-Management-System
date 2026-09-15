using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The count and the revenue tested for Paid exactly, so an order left both the moment any money
/// went back: refunding one dollar of a twenty-six dollar order removed the whole twenty-six from
/// the day's takings.
/// </summary>
public class OrderRevenuePolicyTests
{
    [Fact]
    public void APaidOrderCountsInFull()
    {
        Assert.Equal(26.61m, OrderRevenuePolicy.NetRevenue(PaymentStatus.Paid, 26.61m, 0));
    }

    /// <summary>The defect, in one assertion.</summary>
    [Fact]
    public void APartialRefundIsNettedOffRatherThanErasingTheOrder()
    {
        Assert.Equal(25.61m, OrderRevenuePolicy.NetRevenue(PaymentStatus.PartiallyRefunded, 26.61m, 100));
    }

    /// <summary>It happened, and contributed nothing. Those are different from never happening.</summary>
    [Fact]
    public void AFullyRefundedOrderStillCountsAsSettledAndContributesNothing()
    {
        Assert.True(OrderRevenuePolicy.IsSettled(PaymentStatus.Refunded));
        Assert.Equal(0m, OrderRevenuePolicy.NetRevenue(PaymentStatus.Refunded, 26.61m, 2_661));
    }

    [Fact]
    public void NoDayHasNegativeTakings()
    {
        Assert.Equal(0m, OrderRevenuePolicy.NetRevenue(PaymentStatus.Refunded, 26.61m, 5_000));
    }

    [Theory]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Pending)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Cancelled)]
    [InlineData(PaymentStatus.Expired)]
    // Settled at the till, so the platform never took it — "completed payments only", as decided.
    [InlineData(PaymentStatus.NotRequired)]
    public void MoneyThatNeverArrivedCountsForNothing(PaymentStatus status)
    {
        Assert.False(OrderRevenuePolicy.IsSettled(status));
        Assert.Equal(0m, OrderRevenuePolicy.NetRevenue(status, 26.61m, 0));
    }
}
