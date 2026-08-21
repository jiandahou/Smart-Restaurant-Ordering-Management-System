using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Joining by restaurant id with no ordering mode was answered 200 with a takeaway cart. For a
/// restaurant offering both, that is the server guessing how a customer intends to eat — which
/// changes what they are quoted and how the kitchen treats the order — and answering as though
/// they had said so.
///
/// <para>
/// A table QR is the opposite case: it is dine-in by definition, so it must keep working without
/// anyone stating it.
/// </para>
/// </summary>
public sealed class CartOrderTypeRequiredTests
{
    private static string JoinBody() => MemberBody("HttpPost(\"join\")");

    [Fact]
    public void JoiningByRestaurantWithoutAnOrderingModeIsRefused()
    {
        var body = JoinBody();

        Assert.Contains("string.IsNullOrWhiteSpace(request.OrderType)", body, StringComparison.Ordinal);
        Assert.Contains("order_type_required", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheRefusalNamesTheChoicesRatherThanJustRejecting()
    {
        // The caller has to render a chooser; telling them only that something is missing leaves
        // them to hard-code the options and drift.
        Assert.Contains("allowedOrderTypes", JoinBody(), StringComparison.Ordinal);
    }

    [Fact]
    public void AnUnrecognisedOrderingModeIsStillRefusedSeparately()
    {
        // "missing" and "not a thing" are different mistakes and deserve different codes.
        var body = JoinBody();

        Assert.Contains("order_type_invalid", body, StringComparison.Ordinal);
    }

    [Fact]
    public void ATableQrStillNeedsNothingStated()
    {
        // Requiring it here would break every QR code already printed and stuck on a table.
        var body = JoinBody();
        var required = body.IndexOf("order_type_required", StringComparison.Ordinal);
        var restaurantBranch = body.IndexOf("if (hasRestaurantId)", StringComparison.Ordinal);

        Assert.True(restaurantBranch >= 0 && restaurantBranch < required,
            "The requirement is not confined to joins by restaurant id.");
    }

    [Fact]
    public void ATableQrThatClaimsAnotherModeIsRefused()
    {
        // The behaviour that was already right.
        Assert.Contains("Table QR ordering only supports DineIn.", JoinBody(), StringComparison.Ordinal);
    }

    [Fact]
    public void NoOrderingModeIsAssumedForACartMadeByRestaurantId()
    {
        // The old default sat outside the branch and applied to anything that did not object. The
        // restaurant branch now assigns it in every path that reaches a cart.
        var body = JoinBody();
        var assignment = body.IndexOf("var requestedOrderType = OrderType.", StringComparison.Ordinal);
        var parse = body.IndexOf("Enum.TryParse<OrderType>", StringComparison.Ordinal);

        Assert.True(assignment >= 0 && parse > assignment,
            "Nothing parses the caller's stated ordering mode.");
        Assert.DoesNotContain("var requestedOrderType = OrderType.Takeaway;", body, StringComparison.Ordinal);
    }

    private static string MemberBody(string marker)
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);

        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "PublicCartsController.cs");
    }
}
