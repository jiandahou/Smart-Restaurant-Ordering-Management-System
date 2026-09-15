using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Two people editing one menu item did not each save their own change. The update carries every
/// field, so the second save arrived holding the first person's fields as they had been before, and
/// put them back. Both requests answered 200; the first person's description was simply gone, with
/// nothing anywhere to say why.
///
/// <para>
/// Asserted against the source because none of it fails at runtime — a silent revert is an ordinary
/// successful update.
/// </para>
/// </summary>
public sealed class MenuItemConcurrencyTests
{
    private static string UpdateAction() => ActionBody("HttpPut(\"{id:guid}\")");

    [Fact]
    public void AStaleSaveIsRefused()
    {
        var body = UpdateAction();

        Assert.Contains("WasChangedElsewhere", body, StringComparison.Ordinal);
        Assert.Contains("menu_item_conflict", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheVersionIsRequiredRatherThanOptional()
    {
        // An optional check is one nobody can rely on: a caller that omits the field would get the
        // old silent-overwrite behaviour back while everything still looked correct.
        var body = UpdateAction();

        Assert.Contains("ExpectedUpdatedAt is null", body, StringComparison.Ordinal);
        Assert.Contains("missing_expected_version", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheConflictCarriesTheVersionThatWon()
    {
        // Without the other person's item, the only thing the editor can be told is "try again",
        // which is how you get someone pressing overwrite to make the message go away.
        var body = UpdateAction();

        Assert.Contains("currentUpdatedAt", body, StringComparison.Ordinal);
        Assert.Contains("item = MapToResponse", body, StringComparison.Ordinal);
    }

    [Fact]
    public void OverwritingIsPossibleButHasToBeAskedFor()
    {
        // A conflict the editor cannot get past is a conflict they will route around — by reloading
        // and retyping, which loses the same work more slowly.
        Assert.Contains("!request.OverwriteConflict", UpdateAction(), StringComparison.Ordinal);
    }

    [Fact]
    public void AnItemThatHasNeverBeenEditedStillHasAVersion()
    {
        // UpdatedAt is null until the first edit. Treating that as "nothing to compare" would leave
        // brand new items unprotected, which is when two people are most likely to be filling in
        // the same dish at once.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("item.UpdatedAt ?? item.CreatedAt", source, StringComparison.Ordinal);
    }

    [Fact]
    public void TheComparisonToleratesTheJsonRoundTripAndNothingLonger()
    {
        // Wide enough that a serialisation rounding difference does not reject every save, far
        // narrower than the gap between two people pressing Save.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("TotalMilliseconds) > 1", source, StringComparison.Ordinal);
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

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "AdminMenuItemsController.cs");
    }
}
