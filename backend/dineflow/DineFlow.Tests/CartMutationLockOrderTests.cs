using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Every route that writes a cart must take the cart's row lock first, so that all writers queue in
/// the same order.
///
/// <para>
/// Adding and updating an item took <c>SELECT … FOR UPDATE</c> on the cart and then wrote its lines.
/// Removing an item, clearing the cart and setting the note did neither: no transaction, no lock,
/// and a single <c>SaveChanges</c> that wrote the lines and the cart row in whatever order Entity
/// Framework chose. Two writers therefore approached the same two rows from opposite ends — one
/// holding the cart and reaching for a line, the other holding the line and reaching for the cart —
/// and Postgres broke the cycle the only way it can, by killing one of them. The customer whose
/// request lost got a 500.
/// </para>
///
/// <para>
/// Found by firing random add/update/remove sequences at one shared cart from several devices at
/// once: seven <c>40P01 deadlock detected</c> failures across six rounds, in AddItem while it waited
/// for the cart row and in DeleteItem while it waited for a line.
/// </para>
///
/// <para>
/// Asserted against the source, as the sibling concurrency tests are: a deadlock needs two real
/// connections racing inside Postgres, and it is a probabilistic event even then. What can be
/// checked exactly is the property that prevents it — one lock, taken first, by everyone. This also
/// catches the next route added without it, which is how the three above came to be missing.
/// </para>
/// </summary>
public sealed class CartMutationLockOrderTests
{
    /// <summary>Every route that writes cart lines or the cart row, by its route attribute.</summary>
    public static TheoryData<string, string> CartWritingRoutes() => new()
    {
        { "HttpPost(\"{cartId:guid}/items\")", "adding an item" },
        { "HttpPut(\"{cartId:guid}/items/{cartItemId:guid}\")", "updating a line" },
        { "HttpDelete(\"{cartId:guid}/items/{cartItemId:guid}\")", "removing a line" },
        { "HttpDelete(\"{cartId:guid}/items\")", "clearing the cart" },
        { "HttpPut(\"{cartId:guid}/note\")", "setting the note" },
        { "HttpPost(\"{cartId:guid}/checkout\")", "checking out" },
    };

    [Theory]
    [MemberData(nameof(CartWritingRoutes))]
    public void EveryCartWriteTakesTheSameLockFirst(string marker, string what)
    {
        var body = MemberBody(marker);

        var begin = body.IndexOf("BeginTransactionAsync", StringComparison.Ordinal);
        var locked = LocksCartRow(body);

        Assert.True(begin >= 0, $"The route for {what} writes without a transaction, so its lock would be released at once.");
        Assert.True(locked >= 0, $"The route for {what} writes without locking the cart, which is how the lock order splits.");
        Assert.True(begin < locked, $"The route for {what} locks outside its transaction.");
    }

    /// <summary>The lock is worth nothing if the write lands after the transaction has committed.</summary>
    [Theory]
    [MemberData(nameof(CartWritingRoutes))]
    public void TheLockIsStillHeldWhenTheWriteLands(string marker, string what)
    {
        var body = MemberBody(marker);

        var locked = LocksCartRow(body);
        var save = body.IndexOf("SaveChangesAsync", StringComparison.Ordinal);
        var commit = body.IndexOf("transaction.CommitAsync", StringComparison.Ordinal);

        Assert.True(save > locked, $"The route for {what} saves before it holds the lock.");
        Assert.True(commit > locked, $"The route for {what} commits before it holds the lock.");
    }

    /// <summary>
    /// An early return that leaves the transaction open would hold the cart's row lock until the
    /// request was disposed, blocking every other device at the table behind a no-op.
    /// </summary>
    [Fact]
    public void ClearingAnAlreadyEmptyCartReleasesTheLock()
    {
        var body = MemberBody("HttpDelete(\"{cartId:guid}/items\")");
        var emptyCase = body.IndexOf("items.Count == 0", StringComparison.Ordinal);

        Assert.True(emptyCase >= 0, "The empty-cart shortcut has moved.");

        var afterEmptyCase = body[emptyCase..];
        var commit = afterEmptyCase.IndexOf("transaction.CommitAsync", StringComparison.Ordinal);
        var returns = afterEmptyCase.IndexOf("return await ReturnUpdatedCartAsync", StringComparison.Ordinal);

        Assert.True(commit >= 0 && commit < returns,
            "Clearing an empty cart returns without committing, so the lock is held for nothing.");
    }

    /// <summary>
    /// Where a route first locks the cart's row, however it spells it. Checkout writes the
    /// <c>FOR UPDATE</c> inline rather than calling the helper; both hold the same lock, and what
    /// matters here is that one is taken, not which name it goes by.
    /// </summary>
    private static int LocksCartRow(string body)
    {
        var viaHelper = body.IndexOf("LockCartAsync", StringComparison.Ordinal);
        var inline = body.IndexOf("FOR UPDATE", StringComparison.Ordinal);

        return viaHelper < 0 ? inline : inline < 0 ? viaHelper : Math.Min(viaHelper, inline);
    }

    /// <summary>The source of one member, from its marker to the next one.</summary>
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
