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

    /// <summary>
    /// An order with no stored hash was never issued a credential, so nothing can prove it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// These were let through on the order id alone while the guest orders placed before tokens
    /// existed were still live, so customers mid-order did not lose access. That transition is
    /// over — the last such order was placed on 8 August 2026 — and the id alone authorised reading
    /// an order and filing a refund request against it. An order id turns up in browser histories,
    /// screenshots and shared links; it is not a secret.
    /// </para>
    /// <para>
    /// Signed-in customers do not come through here. Their orders carry no hash either, and every
    /// caller checks the account first, reaching this only when no account is behind the order.
    /// </para>
    /// </remarks>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnOrderWithNoStoredSecretCannotBeProven(string? storedHash)
    {
        Assert.False(GuestAccessTokenService.IsAuthorized(storedHash, providedToken: null));
        Assert.False(GuestAccessTokenService.IsAuthorized(storedHash, providedToken: "anything"));
    }
}
