using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An order recorded which version of the allergen notice the customer acknowledged, but not the
/// declarations they actually read — those were only ever live on the menu. The moment a restaurant
/// corrected a dish, every past order started describing the corrected version, and there was no
/// longer any record of what the customer was shown and accepted.
///
/// <para>
/// Asserted against the source: nothing here fails at runtime. An order that silently reflects
/// today's menu returns 200 and looks entirely correct.
/// </para>
/// </summary>
public sealed class OrderAllergenSnapshotTests
{
    /// <summary>Both paths that turn a menu item into an order line.</summary>
    public static TheoryData<string> OrderCreationPaths() => new() { "OrderController.cs", "PublicCartsController.cs" };

    [Theory]
    [MemberData(nameof(OrderCreationPaths))]
    public void PlacingAnOrderFreezesTheDishDeclaration(string controller)
    {
        var source = File.ReadAllText(ControllerPath(controller));

        Assert.Contains("AllergensSnapshot = NormalizeDisclosureSnapshot(menuItem.Allergens)", source, StringComparison.Ordinal);
        Assert.Contains("MayContainAllergensSnapshot = NormalizeDisclosureSnapshot(menuItem.MayContainAllergens)", source, StringComparison.Ordinal);
        Assert.Contains("CrossContactStatementSnapshot = NormalizeDisclosureSnapshot(menuItem.CrossContactStatement)", source, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(OrderCreationPaths))]
    public void TheSnapshotIsNormalisedRatherThanCopiedRaw(string controller)
    {
        // A blank that survives as "   " reads, downstream, as a declaration somebody made.
        var source = File.ReadAllText(ControllerPath(controller));

        Assert.Contains("string.IsNullOrWhiteSpace(value) ? null : value.Trim()", source, StringComparison.Ordinal);
    }

    [Theory]
    [MemberData(nameof(OrderCreationPaths))]
    public void TheDeclarationIsFrozenBesideTheNameAndPrice(string controller)
    {
        // The three snapshots belong to the same act: recording what was ordered, at what price,
        // described how. One of them being live while the others are frozen is the bug.
        var source = File.ReadAllText(ControllerPath(controller));

        var name = source.IndexOf("MenuItemNameSnapshot = menuItem.Name", StringComparison.Ordinal);
        var allergens = source.IndexOf("AllergensSnapshot = NormalizeDisclosureSnapshot(menuItem.Allergens)", StringComparison.Ordinal);

        Assert.True(name >= 0 && allergens > name, "The allergen snapshot is not taken with the name snapshot.");
    }

    /// <summary>
    /// A snapshot nothing reads back is a column, not a record. Every view that shows an order line
    /// has to carry it — the customer's, the admin's, and the staff view built from the same DTO.
    /// </summary>
    [Fact]
    public void EveryOrderLineProjectionReadsTheSnapshotBack()
    {
        string[] controllers = ["OrderController.cs", "PublicCartsController.cs", "AdminOrdersController.cs"];

        foreach (var controller in controllers)
        {
            var source = File.ReadAllText(ControllerPath(controller));

            Assert.True(
                source.Contains("AllergensSnapshot = item.AllergensSnapshot", StringComparison.Ordinal),
                $"{controller} stores the declaration but never returns it.");
        }
    }

    /// <summary>
    /// Refund records deliberately do not carry it. A refund line names a dish and an amount; it is
    /// not the document that says what the customer was told, and copying the field there would
    /// spread the snapshot without giving anyone a reason to trust it.
    /// </summary>
    [Fact]
    public void RefundRecordsAreLeftAlone()
    {
        var source = File.ReadAllText(ControllerPath("PaymentsController.cs"));

        Assert.DoesNotContain("AllergensSnapshot", source, StringComparison.Ordinal);
    }

    private static string ControllerPath(string fileName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", fileName);
    }
}
