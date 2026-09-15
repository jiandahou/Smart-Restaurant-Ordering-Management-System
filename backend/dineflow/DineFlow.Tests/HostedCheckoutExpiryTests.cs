using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class HostedCheckoutExpiryTests
{
    private static readonly DateTime Now = new(2026, 8, 12, 9, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void DefaultWindowIsBoundedRatherThanStripesTwentyFourHours()
    {
        var expiresAt = HostedCheckoutExpiry.ExpiresAt(Now);

        Assert.Equal(Now.AddHours(1), expiresAt);
        Assert.True(expiresAt < Now.Add(HostedCheckoutExpiry.Maximum));
    }

    /// A window Stripe would reject has to become a link that works, not a checkout that cannot be
    /// created at all — a customer standing at a table must never be blocked by our configuration.
    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(29)]
    public void ShorterThanStripeAllowsIsRaisedToTheMinimum(int minutes)
    {
        Assert.Equal(
            Now.Add(HostedCheckoutExpiry.Minimum),
            HostedCheckoutExpiry.ExpiresAt(Now, TimeSpan.FromMinutes(minutes)));
    }

    [Theory]
    [InlineData(25)]
    [InlineData(200)]
    public void LongerThanStripeAllowsIsCappedAtTheMaximum(int hours)
    {
        Assert.Equal(
            Now.Add(HostedCheckoutExpiry.Maximum),
            HostedCheckoutExpiry.ExpiresAt(Now, TimeSpan.FromHours(hours)));
    }

    [Fact]
    public void AWindowStripeAcceptsIsPassedThroughUnchanged()
    {
        Assert.Equal(
            Now.AddMinutes(45),
            HostedCheckoutExpiry.ExpiresAt(Now, TimeSpan.FromMinutes(45)));
    }

    /// Stripe measures the window from session creation, so the boundaries are inclusive.
    [Fact]
    public void TheExactBoundsAreAccepted()
    {
        Assert.Equal(Now.Add(HostedCheckoutExpiry.Minimum), HostedCheckoutExpiry.ExpiresAt(Now, HostedCheckoutExpiry.Minimum));
        Assert.Equal(Now.Add(HostedCheckoutExpiry.Maximum), HostedCheckoutExpiry.ExpiresAt(Now, HostedCheckoutExpiry.Maximum));
    }
}
