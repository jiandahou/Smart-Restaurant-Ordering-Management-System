using DineFlow.Infrastructure.Identity;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// How a privacy request is allowed to move.
/// </summary>
/// <remarks>
/// It could not move at all: there was no endpoint to change a status and no screen to press, so a
/// request a customer filed sat in a table nobody was shown. An access or correction request carries
/// a thirty-day deadline counting from the day it was made, and silence is the failure.
/// </remarks>
public class PrivacyRequestWorkflowTests
{
    private static readonly DateTime Now = new(2026, 8, 17, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void AReceivedRequestCanBeStartedOrAnswered()
    {
        Assert.Null(PrivacyRequestWorkflow.Refuse("Received", "InProgress"));
        Assert.Null(PrivacyRequestWorkflow.Refuse("Received", "Completed"));
        Assert.Null(PrivacyRequestWorkflow.Refuse("Received", "Declined"));
    }

    [Fact]
    public void WorkInProgressCanOnlyBeAnswered()
    {
        Assert.Null(PrivacyRequestWorkflow.Refuse("InProgress", "Completed"));
        Assert.Null(PrivacyRequestWorkflow.Refuse("InProgress", "Declined"));
        Assert.NotNull(PrivacyRequestWorkflow.Refuse("InProgress", "Received"));
    }

    /// <summary>
    /// An answer given to a person is not taken back quietly. If more is needed it is a new request,
    /// with its own clock.
    /// </summary>
    [Theory]
    [InlineData("Completed")]
    [InlineData("Declined")]
    public void AnAnsweredRequestIsNotReopened(string closed)
    {
        Assert.NotNull(PrivacyRequestWorkflow.Refuse(closed, "InProgress"));
        Assert.NotNull(PrivacyRequestWorkflow.Refuse(closed, "Received"));
        Assert.True(PrivacyRequestWorkflow.IsClosed(closed));
    }

    [Fact]
    public void AnUnknownStatusIsRefused()
    {
        Assert.NotNull(PrivacyRequestWorkflow.Refuse("Received", "Ignored"));
        Assert.NotNull(PrivacyRequestWorkflow.Refuse("Received", ""));
    }

    [Fact]
    public void MovingNowhereIsRefused()
    {
        Assert.NotNull(PrivacyRequestWorkflow.Refuse("InProgress", "InProgress"));
    }

    /// <summary>Thirty days from the day the person asked, not from when someone noticed.</summary>
    [Fact]
    public void TheClockRunsFromWhenTheRequestWasMade()
    {
        Assert.False(PrivacyRequestWorkflow.IsOverdue("Received", Now.AddDays(-29), Now));
        Assert.True(PrivacyRequestWorkflow.IsOverdue("Received", Now.AddDays(-31), Now));

        Assert.Equal(1, PrivacyRequestWorkflow.DaysRemaining("Received", Now.AddDays(-29), Now));
        Assert.Equal(-1, PrivacyRequestWorkflow.DaysRemaining("InProgress", Now.AddDays(-31), Now));
    }

    /// <summary>An answered request has no deadline left to run against it.</summary>
    [Fact]
    public void AnAnsweredRequestHasNoClock()
    {
        Assert.False(PrivacyRequestWorkflow.IsOverdue("Completed", Now.AddDays(-90), Now));
        Assert.Null(PrivacyRequestWorkflow.DaysRemaining("Completed", Now.AddDays(-90), Now));
    }
}
