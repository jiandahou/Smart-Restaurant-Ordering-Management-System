using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class RefundAmountPolicyTests
{
    [Theory]
    [InlineData(null, true)]
    [InlineData(1L, true)]
    [InlineData(0L, false)]
    [InlineData(-1L, false)]
    public void IsValidOverrideAmount_AcceptsNullOrPositive(long? amountCents, bool expected)
    {
        Assert.Equal(expected, RefundAmountPolicy.IsValidOverrideAmount(amountCents));
    }

    [Theory]
    [InlineData(1000L, 1000L, true)]
    [InlineData(1000L, 999L, true)]
    [InlineData(1000L, 1001L, false)]
    [InlineData(1000L, 0L, false)]
    [InlineData(1000L, -1L, false)]
    public void IsWithinRequestedAmount_CapsAtRequestedAmount(long requestedAmountCents, long approvedAmountCents, bool expected)
    {
        Assert.Equal(expected, RefundAmountPolicy.IsWithinRequestedAmount(requestedAmountCents, approvedAmountCents));
    }
}
