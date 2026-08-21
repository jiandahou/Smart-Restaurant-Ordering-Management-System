using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Expiry was detected and reported by the same condition, which made it a one-shot event rather
/// than a state. The first caller to arrive after the deadline was told the cart had expired — and
/// flipped the status on the way past, which made the condition false for everyone after. They fell
/// through as an ordinary cart and were told it was "no longer active" instead. One cart, one
/// reason, a different answer depending on who got there first.
///
/// <para>
/// A second read was worse than inconsistent: it succeeded, handing back an expired cart as though
/// it could still be used.
/// </para>
/// </summary>
public sealed class CartExpiryConsistencyTests
{
    [Fact]
    public void ExpiryIsReportedFromTheStateRatherThanTheTransition()
    {
        var source = File.ReadAllText(AccessServicePath());

        var flip = source.IndexOf("cart.Status = CartStatus.Expired;", StringComparison.Ordinal);
        var report = source.IndexOf("if (cart.Status == CartStatus.Expired)", StringComparison.Ordinal);

        Assert.True(flip >= 0, "Nothing marks a cart expired any more.");
        Assert.True(report > flip, "Expiry is reported from the transition, so only the first caller learns of it.");
    }

    [Fact]
    public void AnAlreadyExpiredCartStillFailsAuthorization()
    {
        // The regression in one line: reporting only `justExpired` is what let every later request
        // through as if the cart were ordinary.
        var source = File.ReadAllText(AccessServicePath());
        var report = source.IndexOf("if (cart.Status == CartStatus.Expired)", StringComparison.Ordinal);

        Assert.True(report >= 0);
        Assert.Contains("CartAccessFailure.Expired", source[report..(report + 300)], StringComparison.Ordinal);
    }

    [Fact]
    public void OnlyTheRequestThatExpiredItAnnouncesIt()
    {
        // Reporting expiry on every request is right; broadcasting it to the whole table on every
        // poll is not.
        var controller = File.ReadAllText(ControllerPath());

        Assert.Contains("if (access.JustExpired)", controller, StringComparison.Ordinal);
        Assert.DoesNotContain(
            "if (access.Failure == CartAccessFailure.Expired)\n        {\n            await cartRealtimeNotifier.CartExpiredAsync",
            controller,
            StringComparison.Ordinal);
    }

    [Fact]
    public void CheckoutAnswersGoneRatherThanConflictForAnExpiredCart()
    {
        // Checkout re-reads the cart under its own lock, so a cart expired by a concurrent request
        // between authorization and that read would otherwise fall into the generic "not active"
        // branch — the same inconsistency, decided by timing.
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf("HttpPost(\"{cartId:guid}/checkout\")", StringComparison.Ordinal);
        var body = source[start..source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal)];

        var expired = body.IndexOf("cart.Status == CartStatus.Expired", StringComparison.Ordinal);
        var notActive = body.IndexOf("cart.Status != CartStatus.Active", StringComparison.Ordinal);

        Assert.True(expired >= 0, "Checkout does not distinguish an expired cart.");
        Assert.True(expired < notActive, "The generic \"not active\" branch claims expired carts first.");
    }

    [Fact]
    public void EveryCartEndpointGoesThroughTheSameAuthorization()
    {
        // The consistency rests on this: one place decides what an expired cart means, so no
        // endpoint can drift into answering differently.
        var controller = File.ReadAllText(ControllerPath());

        Assert.Contains("CartAccessFailure.Expired => StatusCode(\n                StatusCodes.Status410Gone", controller, StringComparison.Ordinal);
    }

    private static string AccessServicePath() =>
        Path.Combine(SolutionDirectory(), "DineFlow.Api", "Services", "CartAccessService.cs");

    private static string ControllerPath() =>
        Path.Combine(SolutionDirectory(), "DineFlow.Api", "Controllers", "PublicCartsController.cs");

    private static string SolutionDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
