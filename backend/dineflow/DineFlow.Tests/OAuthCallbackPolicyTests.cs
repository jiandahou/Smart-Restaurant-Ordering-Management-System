using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A dev proxy rewrote the Host header to a Docker service name, so Google was handed
/// <c>http://backend:8080/api/auth/google/signin</c> and refused every sign-in with a policy error
/// that named nothing. The internal hostname appeared in no log we had.
/// </summary>
public sealed class OAuthCallbackPolicyTests
{
    private const string CallbackPath = "/api/auth/google/signin";

    [Fact]
    public void TheDockerServiceNameThatCausedThisIsRejected()
    {
        var problem = OAuthCallbackPolicy.DescribeProblem("http", "backend:8080", CallbackPath);

        Assert.NotNull(problem);
        // The message has to carry the address itself — that is the one fact nothing else showed.
        Assert.Contains("http://backend:8080/api/auth/google/signin", problem, StringComparison.Ordinal);
        Assert.Contains("changeOrigin", problem, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("localhost:5173")]
    [InlineData("localhost:5000")]
    [InlineData("localhost")]
    [InlineData("127.0.0.1:5000")]
    [InlineData("[::1]:5000")]
    public void LoopbackOverPlainHttpIsFine(string host)
    {
        // The one exception every provider makes, and the whole of local development depends on it.
        Assert.Null(OAuthCallbackPolicy.DescribeProblem("http", host, CallbackPath));
    }

    [Fact]
    public void HttpsIsAlwaysFine()
    {
        Assert.Null(OAuthCallbackPolicy.DescribeProblem(
            "https",
            "dineflow.theunknownfish.com",
            CallbackPath));
    }

    [Fact]
    public void APublicHostOverPlainHttpIsRejected()
    {
        // What a load balancer produces when X-Forwarded-Proto never reaches the app.
        var problem = OAuthCallbackPolicy.DescribeProblem("http", "dineflow.example.com", CallbackPath);

        Assert.NotNull(problem);
        Assert.Contains("X-Forwarded-Proto", problem, StringComparison.Ordinal);
    }

    [Fact]
    public void AHostThatLooksLoopbackButIsNotStaysRejected()
    {
        Assert.NotNull(OAuthCallbackPolicy.DescribeProblem("http", "localhost.evil.example", CallbackPath));
        Assert.NotNull(OAuthCallbackPolicy.DescribeProblem("http", "notlocalhost", CallbackPath));
    }

    [Fact]
    public void AMissingHostIsReportedRatherThanPassedThrough()
    {
        Assert.NotNull(OAuthCallbackPolicy.DescribeProblem("https", null, CallbackPath));
        Assert.NotNull(OAuthCallbackPolicy.DescribeProblem("https", "  ", CallbackPath));
    }
}
