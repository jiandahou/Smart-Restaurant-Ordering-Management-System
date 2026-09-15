using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Adding an item reads the cart's lines, decides whether one matches, and writes the new quantity
/// back. Ten callers doing that at once all read the same "before" and all wrote the same "after":
/// every request answered 200 and the cart ended up holding one.
///
/// <para>
/// There were two races in the same few lines, not one. Concurrent adds against an existing line
/// lost increments; concurrent adds when no line existed yet could each insert their own, splitting
/// one item across duplicate rows. A version column would catch the first and not the second, which
/// is why the cart row is locked instead: it makes the read, the decision and the write one step.
/// </para>
///
/// <para>Asserted against the source — a lost update is an ordinary successful request.</para>
/// </summary>
public sealed class CartAddConcurrencyTests
{
    private static string AddItemBody() => MemberBody("HttpPost(\"{cartId:guid}/items\")");

    [Fact]
    public void TheCartIsLockedBeforeItsLinesAreRead()
    {
        var body = AddItemBody();

        var locked = body.IndexOf("LockCartAsync", StringComparison.Ordinal);
        var read = body.IndexOf("dbContext.CartItems", StringComparison.Ordinal);
        var write = body.IndexOf("Quantity += request.Quantity", StringComparison.Ordinal);

        Assert.True(locked >= 0, "Adding an item does not lock the cart.");
        Assert.True(read > locked, "The cart's lines are read before the lock is held.");
        Assert.True(write > locked, "The quantity is written before the lock is held.");
    }

    [Fact]
    public void TheLockIsHeldForTheWholeMutation()
    {
        // A lock released before the write would serialise nothing.
        var body = AddItemBody();

        var begin = body.IndexOf("BeginTransactionAsync", StringComparison.Ordinal);
        var locked = body.IndexOf("LockCartAsync", StringComparison.Ordinal);
        var commit = body.IndexOf("transaction.CommitAsync", StringComparison.Ordinal);

        Assert.True(begin >= 0 && begin < locked, "The lock is taken outside a transaction, so it is released at once.");
        Assert.True(commit > locked, "The transaction commits before the mutation completes.");
    }

    [Fact]
    public void TheLockQueryDoesNotTrackTheCart()
    {
        // Authorization already loaded this cart, and a tracked entity wins identity resolution: a
        // tracking query here would hand back the pre-lock instance and discard the locked row —
        // the exact trap that made the checkout lock useless.
        var source = File.ReadAllText(ControllerPath());
        var lockMethod = source.IndexOf("private Task LockCartAsync", StringComparison.Ordinal);

        Assert.True(lockMethod >= 0);

        var body = source[lockMethod..(lockMethod + 500)];

        Assert.Contains("FOR UPDATE", body, StringComparison.Ordinal);
        Assert.Contains("AsNoTracking", body, StringComparison.Ordinal);
    }

    [Fact]
    public void LockingAndIdempotencyBothApply()
    {
        // They answer different questions — "is this the same intent?" and "who goes first?" — and
        // removing either one reopens a defect the other does not cover.
        var body = AddItemBody();

        Assert.Contains("LockCartAsync", body, StringComparison.Ordinal);
        Assert.Contains("TryClaimMutationAsync", body, StringComparison.Ordinal);
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
