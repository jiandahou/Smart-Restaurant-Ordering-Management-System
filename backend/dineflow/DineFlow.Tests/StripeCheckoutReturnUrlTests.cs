using DineFlow.Api.Services;
using Microsoft.AspNetCore.WebUtilities;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-003. Stripe only substitutes <c>{CHECKOUT_SESSION_ID}</c> when the braces reach it intact,
/// so these assert the encoding rather than just the shape of the URL.
/// </summary>
public sealed class StripeCheckoutReturnUrlTests
{
    [Fact]
    public void WithSessionId_LeavesThePlaceholderBracesUnencoded()
    {
        var url = StripeCheckoutReturnUrl.WithSessionId("https://app.example/payment/success");

        Assert.Equal(
            "https://app.example/payment/success?session_id={CHECKOUT_SESSION_ID}",
            url);
        Assert.DoesNotContain("%7B", url, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("%7D", url, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void QueryHelpers_EncodesThePlaceholder_WhichIsTheBugThisTypeExistsToPrevent()
    {
        // Documents why the helper concatenates instead: this is what the old call sites produced,
        // and Stripe redirects with the literal %7BCHECKOUT_SESSION_ID%7D still in the URL.
        var encoded = QueryHelpers.AddQueryString(
            "https://app.example/payment/success",
            "session_id",
            StripeCheckoutReturnUrl.SessionIdPlaceholder);

        Assert.Contains("%7BCHECKOUT_SESSION_ID%7D", encoded, StringComparison.Ordinal);
        Assert.NotEqual(encoded, StripeCheckoutReturnUrl.WithSessionId("https://app.example/payment/success"));
    }

    [Fact]
    public void WithSessionId_AppendsWithAmpersandWhenTheUrlAlreadyHasAQuery()
    {
        // The order flow adds returnTo first, so the session id is almost always the second param.
        var url = StripeCheckoutReturnUrl.WithSessionId(
            "https://app.example/payment/success?returnTo=%2Ftable%2Fabc");

        Assert.Equal(
            "https://app.example/payment/success?returnTo=%2Ftable%2Fabc&session_id={CHECKOUT_SESSION_ID}",
            url);
    }

    [Fact]
    public void WithSessionId_DoesNotAddTheParameterTwiceWhenItIsAlreadyConfigured()
    {
        const string configured = "https://app.example/payment/success?session_id={CHECKOUT_SESSION_ID}";

        Assert.Equal(configured, StripeCheckoutReturnUrl.WithSessionId(configured));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WithSessionId_FallsBackToAUsableUrlWhenTheSettingIsMissing(string? configured)
    {
        var url = StripeCheckoutReturnUrl.WithSessionId(configured);

        Assert.Equal("http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}", url);
    }

    [Fact]
    public void WithSessionId_UsesTheCallersFallbackWhenOneIsSupplied()
    {
        var url = StripeCheckoutReturnUrl.WithSessionId(null, "https://app.example/admin/restaurants");

        Assert.Equal("https://app.example/admin/restaurants?session_id={CHECKOUT_SESSION_ID}", url);
    }
}
