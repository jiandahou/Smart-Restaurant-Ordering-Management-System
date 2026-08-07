using System.Net;
using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class StripeFailureClassifierTests
{
    [Fact]
    public void NoResponseAtAll_IsIndeterminate()
    {
        // A dropped connection or client-side timeout tells us nothing about what Stripe did.
        Assert.Equal(
            StripeFailureKind.Indeterminate,
            StripeFailureClassifier.Classify(null, hasStripeError: false));
        Assert.Equal(
            StripeFailureKind.Indeterminate,
            StripeFailureClassifier.Classify(0, hasStripeError: false));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.GatewayTimeout)]
    public void StripeSideFailures_AreIndeterminate(HttpStatusCode status)
    {
        // Stripe may have accepted the refund before failing to answer.
        Assert.Equal(
            StripeFailureKind.Indeterminate,
            StripeFailureClassifier.Classify(status, hasStripeError: true));
    }

    [Theory]
    [InlineData(HttpStatusCode.RequestTimeout)]
    [InlineData((HttpStatusCode)429)]
    public void TimeoutAndThrottling_AreIndeterminate(HttpStatusCode status)
    {
        Assert.Equal(
            StripeFailureKind.Indeterminate,
            StripeFailureClassifier.Classify(status, hasStripeError: true));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.PaymentRequired)]
    [InlineData(HttpStatusCode.Conflict)]
    public void StructuredFourXx_IsAFinalDecline(HttpStatusCode status)
    {
        // Stripe answered and refused, so the money definitely did not move.
        Assert.Equal(
            StripeFailureKind.Declined,
            StripeFailureClassifier.Classify(status, hasStripeError: true));
    }

    [Fact]
    public void FourXxWithoutAStripeError_StaysIndeterminate()
    {
        // Something between us and Stripe answered — that is not Stripe declining.
        Assert.Equal(
            StripeFailureKind.Indeterminate,
            StripeFailureClassifier.Classify(HttpStatusCode.BadRequest, hasStripeError: false));
    }
}
