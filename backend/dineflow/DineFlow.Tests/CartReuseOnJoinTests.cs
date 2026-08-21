using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Joining by table QR reused the table's open cart. Joining by restaurant — every takeaway, every
/// "Order again" — always made a new one. So a signed-in customer pressing "Order again" twice
/// finished with two active carts for the same restaurant: the second on screen, the first left in
/// the database holding items nobody would ever see again.
///
/// <para>
/// Asserted against the source, because both carts are perfectly valid rows and both requests
/// answered 200. Nothing about the outcome looks wrong from the inside.
/// </para>
/// </summary>
public sealed class CartReuseOnJoinTests
{
    private static string JoinBody() => MemberBody("HttpPost(\"join\")");

    [Fact]
    public void JoiningByRestaurantResumesAnOpenCartRatherThanStartingAnother()
    {
        var body = JoinBody();

        Assert.Contains("FindResumableCartAsync", body, StringComparison.Ordinal);
        Assert.Contains("existingCart ?? new Cart", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AResumedCartIsNotInsertedASecondTime()
    {
        // Adding it again would be an insert of a row that already exists.
        Assert.Contains("if (existingCart is null)", JoinBody(), StringComparison.Ordinal);
    }

    [Fact]
    public void OnlyASignedInCustomersCartCanBeResolved()
    {
        // A guest is identified by the participant token their browser holds. A request without one
        // is, as far as the server can tell, a different person — resuming somebody else's cart on
        // a guess would be worse than making a new one.
        var body = JoinBody();

        Assert.Contains("string.IsNullOrWhiteSpace(currentUserId)", body, StringComparison.Ordinal);
    }

    [Fact]
    public void OnlyOpenUnexpiredCartsOfTheSameKindAreResumed()
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf("private async Task<Cart?> FindResumableCartAsync", StringComparison.Ordinal);

        Assert.True(start >= 0, "FindResumableCartAsync is gone — has it been renamed?");

        var body = source[start..(start + 1_500)];

        Assert.Contains("cart.Status == CartStatus.Active", body, StringComparison.Ordinal);
        Assert.Contains("cart.ExpiresAt > now", body, StringComparison.Ordinal);
        Assert.Contains("cart.OrderType == orderType", body, StringComparison.Ordinal);
        Assert.Contains("cart.TableId == null", body, StringComparison.Ordinal);
        Assert.Contains("participant.CustomerId == customerId", body, StringComparison.Ordinal);
    }

    [Fact]
    public void ThePickIsDeterministicWhenOlderDataLeftMoreThanOneBehind()
    {
        // This bug has already produced duplicates in any database it ran against. Resuming an
        // arbitrary one of them would make the customer's cart depend on query planning.
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf("private async Task<Cart?> FindResumableCartAsync", StringComparison.Ordinal);

        Assert.Contains("OrderByDescending", source[start..(start + 1_500)], StringComparison.Ordinal);
    }

    /// <summary>The behaviour that was already right, and must stay right.</summary>
    [Fact]
    public void JoiningByTableStillReusesTheTablesCart()
    {
        Assert.Contains("item.TableId == table.Id && item.Status == CartStatus.Active", JoinBody(), StringComparison.Ordinal);
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
