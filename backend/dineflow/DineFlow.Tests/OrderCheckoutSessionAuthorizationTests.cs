using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Starting a Stripe session for an order must prove who is asking.
///
/// <para>
/// Every other guest-reachable order route — looking one up, cancelling it, changing how it is paid
/// — checks the token issued when the order was placed. This one ended its authorization check on an
/// unconditional <c>return true</c> for guest orders, so an order id on its own was enough to mint a
/// checkout session for somebody else's order. That discloses what they ordered and for how much on
/// the Stripe page, and it leaves their order carrying a payment in flight, which locks its real
/// owner out of changing how they pay.
/// </para>
///
/// <para>
/// Found by firing wrong tokens at every guest route: this one answered 409 to all of them, not the
/// 403 its siblings gave, because the request never failed on identity at all — it got as far as
/// asking whether the restaurant could take a card.
/// </para>
///
/// <para>
/// Asserted against the source: the check lives in a private method on a controller with the whole
/// payment stack behind it, and what is worth pinning is that the guest branch consults the token.
/// </para>
/// </summary>
public sealed class OrderCheckoutSessionAuthorizationTests
{
    [Fact]
    public void TheGuestBranchChecksTheToken()
    {
        var body = AuthorizationMethodBody();

        Assert.Contains("GuestAccessTokenService.IsAuthorized", body, StringComparison.Ordinal);
    }

    /// <summary>
    /// The defect exactly: a bare "return true" as the last word on a guest order. Orders placed
    /// before tokens existed still get through, but by carrying no hash — a decision
    /// <see cref="DineFlow.Api.Services.GuestAccessTokenService"/> makes for every route at once,
    /// not one this method may make for itself.
    /// </summary>
    [Fact]
    public void NoGuestOrderIsWavedThroughUnconditionally()
    {
        var body = AuthorizationMethodBody();
        var customerBranch = body.IndexOf("order.CustomerId", StringComparison.Ordinal);

        Assert.True(customerBranch >= 0, "The signed-in customer branch has moved.");

        var afterCustomerBranch = body[customerBranch..];

        Assert.DoesNotContain("return true;", afterCustomerBranch, StringComparison.Ordinal);
    }

    [Fact]
    public void TheRequestCarriesAPlaceForTheToken()
    {
        var contract = File.ReadAllText(Path.Combine(
            ApiDirectory(), "Contracts", "Payments", "CreateOrderCheckoutSessionRequest.cs"));

        Assert.Contains("GuestAccessToken", contract, StringComparison.Ordinal);
    }

    /// <summary>A token the caller sent and the check never received would authorise nothing.</summary>
    [Fact]
    public void EveryCallerHandsTheTokenOver()
    {
        var source = File.ReadAllText(ControllerPath());
        var calls = source.Split("CanStartCheckoutSessionForOrderAsync(").Length - 1;

        Assert.True(calls >= 3, "Expected the definition and at least two call sites.");
        Assert.Equal(
            calls,
            source.Split("CanStartCheckoutSessionForOrderAsync(order, request.GuestAccessToken)").Length - 1
                + source.Split("CanStartCheckoutSessionForOrderAsync(Order order, string? guestAccessToken)").Length - 1);
    }

    private static string AuthorizationMethodBody()
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf(
            "private async Task<bool> CanStartCheckoutSessionForOrderAsync",
            StringComparison.Ordinal);

        Assert.True(start >= 0, "The authorization check has been renamed.");

        var next = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);
        return next < 0 ? source[start..] : source[start..next];
    }

    private static string ControllerPath() =>
        Path.Combine(ApiDirectory(), "Controllers", "PaymentsController.cs");

    private static string ApiDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api");
    }
}
