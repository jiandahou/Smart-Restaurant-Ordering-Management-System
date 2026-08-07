using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class GuestAccessTokenServiceTests
{
    [Fact]
    public void IssuedTokenMatchesItsOwnHash()
    {
        var (token, hash) = GuestAccessTokenService.Issue();

        Assert.True(GuestAccessTokenService.IsAuthorized(hash, token));
    }

    [Fact]
    public void TokensAreUnpredictable()
    {
        var tokens = Enumerable.Range(0, 50)
            .Select(_ => GuestAccessTokenService.Issue().Token)
            .ToList();

        Assert.Equal(tokens.Count, tokens.Distinct().Count());
        // 32 random bytes, base64url without padding.
        Assert.All(tokens, token => Assert.True(token.Length >= 43));
    }

    [Fact]
    public void StoredValueIsAHashRatherThanTheToken()
    {
        // A database or log leak must not yield anything replayable against the API.
        var (token, hash) = GuestAccessTokenService.Issue();

        Assert.NotEqual(token, hash);
        Assert.Equal(64, hash.Length);
        Assert.Matches("^[0-9a-f]+$", hash);
    }

    [Fact]
    public void WrongTokenIsRejected()
    {
        var (_, hash) = GuestAccessTokenService.Issue();
        var (otherToken, _) = GuestAccessTokenService.Issue();

        Assert.False(GuestAccessTokenService.IsAuthorized(hash, otherToken));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void MissingTokenIsRejectedWhenOneIsRequired(string? providedToken)
    {
        var (_, hash) = GuestAccessTokenService.Issue();

        Assert.False(GuestAccessTokenService.IsAuthorized(hash, providedToken));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void OrdersPredatingTokensStayReachable(string? storedHash)
    {
        // Deliberate transition behaviour: existing guest orders have no hash and must not become
        // unreachable mid-order. Tighten this once they have aged out.
        Assert.True(GuestAccessTokenService.IsAuthorized(storedHash, providedToken: null));
        Assert.True(GuestAccessTokenService.IsAuthorized(storedHash, providedToken: "anything"));
    }
}
