using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A dine-in cart is shared: everyone at the table holds the same one. Editing a line sets an
/// absolute quantity, so two people editing the same line both succeeded and the later write simply
/// replaced the earlier. Both were answered 200, and the person whose change vanished had no way to
/// learn it had ever applied.
///
/// <para>
/// Two mechanisms, answering two different questions. The lock decides who goes first, which is
/// what makes the check below meaningful at all — without it, simultaneous editors read the same
/// version, both pass, and both write. The version turns a *stale* edit, made against a view from
/// minutes ago, into a conflict rather than a silent overwrite.
/// </para>
/// </summary>
public sealed class CartItemUpdateConcurrencyTests
{
    private static string UpdateItemBody() => MemberBody("HttpPut(\"{cartId:guid}/items/{cartItemId:guid}\")");

    [Fact]
    public void AStaleEditIsRefusedRatherThanApplied()
    {
        var body = UpdateItemBody();

        Assert.Contains("CartItemWasChangedElsewhere", body, StringComparison.Ordinal);
        Assert.Contains("cart_item_conflict", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheVersionIsRequiredRatherThanOptional()
    {
        // A precondition the caller may omit is one nobody can rely on: an older client would keep
        // silently overwriting while everything still looked correct.
        var body = UpdateItemBody();

        Assert.Contains("request.ExpectedUpdatedAt is null", body, StringComparison.Ordinal);
        Assert.Contains("missing_expected_version", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheConflictCarriesTheCartAsItNowStands()
    {
        // Rejecting the edit is half an answer. Without the other half the screen keeps describing
        // a version that no longer exists, and the next attempt is just as stale.
        var body = UpdateItemBody();

        Assert.Contains("cart = current", body, StringComparison.Ordinal);
        Assert.Contains("LoadSnapshotAsync", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheCheckRunsUnderTheCartLock()
    {
        // Read, check and write have to be one step. Two simultaneous editors reading the same
        // version would otherwise both pass the check and both write — the exact defect being
        // fixed, now with a conflict check that never fires.
        var body = UpdateItemBody();

        var locked = body.IndexOf("LockCartAsync", StringComparison.Ordinal);
        var check = body.IndexOf("CartItemWasChangedElsewhere", StringComparison.Ordinal);
        var commit = body.IndexOf("transaction.CommitAsync", StringComparison.Ordinal);

        Assert.True(locked >= 0, "The cart is not locked while the line is edited.");
        Assert.True(check > locked, "The version is checked before the lock is held.");
        Assert.True(commit > check, "The transaction commits before the check has run.");
    }

    [Fact]
    public void ALineNobodyHasEditedYetStillHasAVersion()
    {
        // UpdatedAt is null until the first edit — which is exactly when two people at a table are
        // most likely to be adjusting something just added.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("item.UpdatedAt ?? item.CreatedAt", source, StringComparison.Ordinal);
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
