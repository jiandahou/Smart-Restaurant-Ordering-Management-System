using DineFlow.Api.Services;
using Microsoft.AspNetCore.Http;
using Stripe;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Everything that was not a half-finished Connect platform came back as "please try again". Some
/// of those failures never resolve — Stripe does not operate everywhere — so that advice sent the
/// operator round a loop with no exit, and hid the one fact that would let them fix it.
/// </summary>
public class StripeOnboardingFailureTests
{
    private static StripeException WithCode(string? code, string message = "Something went wrong.")
        => new(message) { StripeError = new StripeError { Code = code, Message = message } };

    [Fact]
    public void AnUnsupportedCountryNamesTheCountryAndDoesNotSuggestRetrying()
    {
        var failure = StripeOnboardingFailure.Describe(
            WithCode("country_unsupported", "NP is not currently supported by Stripe."),
            "NP");

        Assert.Equal("stripe_country_unsupported", failure.Code);
        Assert.Contains("NP", failure.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("try again", failure.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Nothing is wrong with Stripe and nothing about waiting changes it, so this is not a gateway
    /// failure — a 502 invites the caller, and any retry logic, to treat it as transient.
    /// </summary>
    [Fact]
    public void AnUnsupportedCountryIsNotReportedAsAStripeOutage()
    {
        var failure = StripeOnboardingFailure.Describe(WithCode("country_unsupported"), "NP");

        Assert.Equal(StatusCodes.Status409Conflict, failure.StatusCode);
    }

    /// The message reaches a restaurant owner, so it says what to do about it.
    [Fact]
    public void AnUnsupportedCountryOffersAWayForward()
    {
        var failure = StripeOnboardingFailure.Describe(WithCode("country_unsupported"), "NP");

        Assert.Contains("counter payment", failure.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void AnUnsupportedCountryStillReadsSensiblyWithoutACountryCode()
    {
        var failure = StripeOnboardingFailure.Describe(WithCode("country_unsupported"), null);

        Assert.Contains("this restaurant's country", failure.Message, StringComparison.Ordinal);
        Assert.Equal("stripe_country_unsupported", failure.Code);
    }

    [Fact]
    public void AnUnfinishedConnectPlatformStillPointsAtTheSetupGuide()
    {
        var failure = StripeOnboardingFailure.Describe(
            new StripeException("You have not signed up for Connect."),
            "AU");

        Assert.Equal("stripe_connect_setup_incomplete", failure.Code);
        Assert.Equal(StatusCodes.Status409Conflict, failure.StatusCode);
    }

    /// <summary>
    /// A genuinely transient failure keeps the advice that works for it, and keeps the 502 that
    /// tells a caller it is worth trying later.
    /// </summary>
    [Fact]
    public void AnythingElseIsStillWorthRetrying()
    {
        var failure = StripeOnboardingFailure.Describe(WithCode("api_connection_error"), "AU");

        Assert.Equal("stripe_onboarding_failed", failure.Code);
        Assert.Equal(StatusCodes.Status502BadGateway, failure.StatusCode);
        Assert.Contains("try again", failure.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// Stripe's own wording is written for developers and must not be handed to a customer raw.
    [Fact]
    public void TheProvidersOwnWordingIsNotPassedThrough()
    {
        var failure = StripeOnboardingFailure.Describe(
            WithCode("account_invalid", "No such account: 'acct_secret123'"),
            "AU");

        Assert.DoesNotContain("acct_secret123", failure.Message, StringComparison.Ordinal);
    }
}
