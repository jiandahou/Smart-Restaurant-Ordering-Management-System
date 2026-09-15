using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Two concurrent checkouts of one cart produced two orders, two order numbers and two kitchen
/// tickets. Both answered 200. The cart pointed at whichever committed last, and the other order
/// belonged to nobody — no cart referenced it, so nothing would ever pay it or cancel it, while the
/// kitchen saw it all the same.
///
/// <para>
/// The surprising part is that checkout already took <c>SELECT ... FOR UPDATE</c> on the cart, and
/// the lock worked: the second request did wait. What failed is what happened after it woke up.
/// Authorization had already loaded the cart into the change tracker, and a tracked entity wins
/// identity resolution — EF returns that instance and leaves its properties alone. The row the lock
/// had just re-read was discarded, so the loser proceeded on a snapshot taken before the winner
/// existed.
/// </para>
///
/// <para>
/// Asserted against the source: this is a race, and a test that merely calls the method once passes
/// whether or not the bug is present.
/// </para>
/// </summary>
public sealed class CartCheckoutConcurrencyTests
{
    private static string CheckoutAction() => ActionBody("HttpPost(\"{cartId:guid}/checkout\")");

    [Fact]
    public void TheLockedRowIsReadBackBeforeAnyDecisionIsMade()
    {
        // Without this the FOR UPDATE is decoration: it serialises the requests and then lets the
        // second one act on what it knew before it waited.
        var body = CheckoutAction();

        var forUpdate = body.IndexOf("FOR UPDATE", StringComparison.Ordinal);
        var reload = body.IndexOf("ReloadAsync", StringComparison.Ordinal);
        var submittedCheck = body.IndexOf("cart.Status == CartStatus.Submitted", StringComparison.Ordinal);

        Assert.True(forUpdate >= 0, "Checkout no longer locks the cart row.");
        Assert.True(reload > forUpdate, "The locked row is never read back after the lock is taken.");
        Assert.True(submittedCheck > reload, "The already-submitted check runs on a stale snapshot.");
    }

    [Fact]
    public void AnAlreadySubmittedCartReturnsTheOrderItAlreadyHas()
    {
        // The second caller is not an error case. They asked for their order; it exists.
        var body = CheckoutAction();

        Assert.Contains("Order was already submitted.", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheOrderRecordsTheCartItCameFrom()
    {
        Assert.Contains("CartId = cart.Id", CheckoutAction(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheDatabaseRefusesASecondOrderForOneCart()
    {
        // The application fix can be undone by anyone who reorders two lines. This cannot.
        var context = File.ReadAllText(AppDbContextPath());

        Assert.Contains("IX_Orders_CartId_Unique", context, StringComparison.Ordinal);
        Assert.Contains(".IsUnique()", context, StringComparison.Ordinal);
    }

    [Fact]
    public void TheUniqueIndexIgnoresOrdersThatNeverHadACart()
    {
        // Counter and admin orders have no cart. Without the filter the first two would collide.
        var context = File.ReadAllText(AppDbContextPath());
        var index = context.IndexOf("IX_Orders_CartId_Unique", StringComparison.Ordinal);
        var filter = context.IndexOf("\\\"CartId\\\" IS NOT NULL", StringComparison.Ordinal);

        Assert.True(filter >= 0 && Math.Abs(filter - index) < 400, "The unique index is not filtered to carts.");
    }

    [Fact]
    public void LosingToTheIndexReturnsTheCommittedOrderRatherThanAnError()
    {
        // An error here would invite the caller to retry, and every retry would lose the same way.
        var body = CheckoutAction();

        Assert.Contains("IsCartAlreadyOrderedViolation", body, StringComparison.Ordinal);
        Assert.Contains("FindOrderForCartAsync", body, StringComparison.Ordinal);
    }

    [Fact]
    public void OnlyTheCartConstraintIsTreatedAsAlreadyOrdered()
    {
        // Catching every unique violation would turn an unrelated data bug into a cheerful 200.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("SqlState: \"23505\"", source, StringComparison.Ordinal);
        Assert.Contains("postgres.ConstraintName, \"IX_Orders_CartId_Unique\"", source, StringComparison.Ordinal);
    }

    /// <summary>The source of one action, from its attribute to the next member.</summary>
    private static string ActionBody(string marker)
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);

        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string ControllerPath() =>
        Path.Combine(SolutionDirectory(), "DineFlow.Api", "Controllers", "PublicCartsController.cs");

    private static string AppDbContextPath() =>
        Path.Combine(SolutionDirectory(), "DineFlow.Infrastructure", "Persistence", "AppDbContext.cs");

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
