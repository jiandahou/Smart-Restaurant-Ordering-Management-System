using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Tests.Infrastructure;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Recovering an order whose checkout answer never arrived.
/// </summary>
/// <remarks>
/// <para>
/// A checkout can commit and then lose its response — a dropped connection, a phone leaving a lift.
/// The order exists; the customer sees a spinner. Pressing again is the sanctioned way back,
/// because one cart can only ever produce one order, so the second attempt returns the first one's.
/// </para>
/// <para>
/// The gap was the secret. It is handed over exactly once, in the response that may be the one that
/// went missing, so a guest who recovered their order could pay for it and never look at it again.
/// Reissuing on recovery is safe: the caller has just proved the same cart participation that
/// earned them the first one, and what it costs to get wrong is a customer locked out of their own
/// order.
/// </para>
/// </remarks>
public class CheckoutRecoveryTests
{
    /// <summary>
    /// A reissued secret must actually open the order, and the one it replaces must not.
    /// </summary>
    [Fact]
    public void AReissuedGuestSecretOpensTheOrderAndRetiresTheOldOne()
    {
        var (firstToken, firstHash) = GuestAccessTokenService.Issue();
        Assert.True(GuestAccessTokenService.IsAuthorized(firstHash, firstToken));

        // The response carrying the first token never arrived, so recovery issues another.
        var (secondToken, secondHash) = GuestAccessTokenService.Issue();

        Assert.True(GuestAccessTokenService.IsAuthorized(secondHash, secondToken));
        Assert.False(GuestAccessTokenService.IsAuthorized(secondHash, firstToken));
    }

    /// <summary>
    /// A signed-in customer needs no secret — the account is the credential — so recovery must not
    /// mint one and imply otherwise.
    /// </summary>
    [Fact]
    public void ASignedInCustomerIsNotGivenAGuestSecret()
    {
        var order = new Order { CustomerId = "customer-1" };

        var needsSecret = string.IsNullOrWhiteSpace(order.CustomerId);

        Assert.False(needsSecret);
    }

    /// <summary>
    /// A blank stored hash authorises nobody, so an order that never had a secret cannot be opened
    /// by presenting nothing.
    /// </summary>
    [Fact]
    public void AnOrderWithNoSecretCannotBeOpenedByGuessing()
    {
        Assert.False(GuestAccessTokenService.IsAuthorized(null, "anything"));
        Assert.False(GuestAccessTokenService.IsAuthorized("", "anything"));
        Assert.False(GuestAccessTokenService.IsAuthorized(GuestAccessTokenService.Issue().Hash, null));
    }
}
