using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Adding an item does <c>Quantity += request.Quantity</c>, which makes it the one cart operation
/// that is not repeatable. A caller whose connection dropped after the server committed but before
/// the response arrived cannot tell that apart from a request that never landed; retrying is the
/// only thing it can do, and doing so silently doubled the quantity.
///
/// <para>
/// Asserted against the source. A duplicated add is an ordinary successful add — nothing throws,
/// and a test that calls the endpoint once passes either way.
/// </para>
/// </summary>
public sealed class CartAddIdempotencyTests
{
    private static string AddItemBody() => MemberBody("HttpPost(\"{cartId:guid}/items\")");

    [Fact]
    public void TheKeyIsClaimedBeforeAnythingIsAdded()
    {
        var body = AddItemBody();

        var claim = body.IndexOf("TryClaimMutationAsync", StringComparison.Ordinal);
        var mutate = body.IndexOf("Quantity += request.Quantity", StringComparison.Ordinal);

        Assert.True(claim >= 0, "Adding an item does not claim an idempotency key.");
        Assert.True(mutate > claim, "The quantity is changed before the key is claimed.");
    }

    [Fact]
    public void TheClaimAndTheAddShareOneTransaction()
    {
        // If they could commit separately, a crash between them would record a key for an add that
        // never happened — and the retry would be answered with a cart missing the item.
        var body = AddItemBody();

        var begin = body.IndexOf("BeginTransactionAsync", StringComparison.Ordinal);
        var claim = body.IndexOf("TryClaimMutationAsync", StringComparison.Ordinal);
        var commit = body.IndexOf("transaction.CommitAsync", StringComparison.Ordinal);

        Assert.True(begin >= 0 && begin < claim, "The claim happens outside a transaction.");
        Assert.True(commit > claim, "Nothing commits until the claim and the add have both succeeded.");
    }

    [Fact]
    public void ARetryIsAnsweredWithTheCartRatherThanAnError()
    {
        // The caller asked for their item to be in the cart. It is. An error would be both untrue
        // and an invitation to retry again.
        var body = AddItemBody();

        Assert.Contains("This exact add already happened", body, StringComparison.Ordinal);
        Assert.Contains("Ok(replayed)", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheDatabaseDecidesWhetherAKeyIsNew()
    {
        // Reading first and inserting after leaves a window in which two retries both find nothing
        // and both proceed — the exact situation being defended against.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("ON CONFLICT (\"CartId\", \"IdempotencyKey\") DO NOTHING", source, StringComparison.Ordinal);
    }

    [Fact]
    public void KeysAreScopedToTheirCart()
    {
        // Global keys would let one customer's chosen key lock out another's.
        var context = File.ReadAllText(AppDbContextPath());

        Assert.Contains("IX_CartMutations_CartId_IdempotencyKey", context, StringComparison.Ordinal);
    }

    [Fact]
    public void ACallerThatSendsNoKeyStillWorks()
    {
        // The header is optional, so an older client keeps working — without the guarantee.
        var source = File.ReadAllText(ControllerPath());
        var claim = source.IndexOf("private async Task<bool> TryClaimMutationAsync", StringComparison.Ordinal);

        Assert.True(claim >= 0);
        Assert.Contains("string.IsNullOrEmpty(key)", source[claim..], StringComparison.Ordinal);
    }

    [Fact]
    public void AnOverlongKeyIsRejectedRatherThanTruncated()
    {
        // A truncated key could collide with a different caller's, which would drop a real add.
        Assert.Contains("MaximumIdempotencyKeyLength", AddItemBody(), StringComparison.Ordinal);
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
