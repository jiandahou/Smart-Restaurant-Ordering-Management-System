using DineFlow.Infrastructure.Messaging;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// PaymentNotificationService called the provider inline, caught the exception, wrote a log line,
/// and carried on. The email was then gone — no retry, no record that anybody had meant to send it,
/// and no way to answer "was the customer told their refund was approved?" other than asking them.
/// Money moves in these flows, so the answer matters and a log file is not it.
/// </summary>
public sealed class EmailDeliveryPolicyTests
{
    private static readonly DateTime Now = new(2026, 8, 21, 9, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void TheFirstFailureIsRetriedSoon()
    {
        // A provider blip should cost a customer a minute, not a morning.
        Assert.Equal(Now.AddMinutes(1), EmailDeliveryPolicy.NextAttemptAt(1, Now));
    }

    [Fact]
    public void EachFailureWaitsLongerThanTheLast()
    {
        // Hammering a struggling provider is how a short outage becomes a rate-limit ban.
        var waits = Enumerable.Range(1, EmailDeliveryPolicy.RetryDelays.Count)
            .Select(attempt => EmailDeliveryPolicy.NextAttemptAt(attempt, Now)! - Now)
            .ToList();

        Assert.Equal(waits.OrderBy(wait => wait), waits);
        Assert.True(waits.Distinct().Count() == waits.Count, "Two retries wait exactly as long.");
    }

    [Fact]
    public void TheBudgetRunsOut()
    {
        // An unbounded queue is how a dead address turns into permanent load nobody notices.
        Assert.Null(EmailDeliveryPolicy.NextAttemptAt(EmailDeliveryPolicy.MaximumAttempts, Now));
        Assert.True(EmailDeliveryPolicy.IsExhausted(EmailDeliveryPolicy.MaximumAttempts));
        Assert.False(EmailDeliveryPolicy.IsExhausted(EmailDeliveryPolicy.MaximumAttempts - 1));
    }

    [Fact]
    public void ItRidesOutARealisticOutageWithoutDeliveringDaysLate()
    {
        // Both halves matter: too short and a provider incident loses the mail, too long and a
        // refund notice arrives after the customer has already complained.
        var total = EmailDeliveryPolicy.RetryDelays.Aggregate(TimeSpan.Zero, (sum, delay) => sum + delay);

        Assert.True(total >= TimeSpan.FromHours(4), $"Gives up after only {total}.");
        Assert.True(total <= TimeSpan.FromHours(24), $"Still trying {total} later.");
    }

    [Theory]
    [InlineData("Invalid email address")]
    [InlineData("550 5.1.1 user unknown")]
    [InlineData("Recipient rejected")]
    [InlineData("The address has been suppressed")]
    public void AnAddressThatWillNeverWorkIsNotRetried(string providerError)
    {
        // Retrying a hard bounce burns the sending reputation every other email depends on.
        Assert.True(EmailDeliveryPolicy.IsPermanentFailure(providerError));
    }

    [Theory]
    [InlineData("Too many requests")]
    [InlineData("503 Service Unavailable")]
    [InlineData("The operation has timed out")]
    [InlineData("")]
    [InlineData(null)]
    public void AnythingThatMightWorkLaterIsRetried(string? providerError)
    {
        // Conservative on purpose: a dropped transactional email is invisible, a duplicate is only
        // annoying, so an unrecognised error gets the benefit of the doubt.
        Assert.False(EmailDeliveryPolicy.IsPermanentFailure(providerError));
    }

    [Fact]
    public void AnAttemptCountBelowOneAsksForNothing()
    {
        Assert.Null(EmailDeliveryPolicy.NextAttemptAt(0, Now));
    }
}
