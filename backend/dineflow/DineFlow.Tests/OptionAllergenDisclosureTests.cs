using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A dish's allergen declaration describes the dish as listed. Menu options had no allergen fields
/// at all, so adding satay sauce to a curry declared peanut-free changed the plate while the panel
/// the customer reads before ordering went on saying "Soy". A restaurant had no way to disclose it
/// and a customer had no way to see it.
/// </summary>
public sealed class OptionAllergenDisclosureTests
{
    private static AllergenDisclosure Curry(
        params (string Name, string? Allergens, string? MayContain, string? CrossContact)[] modifiers) =>
        AllergenDisclosureBuilder.Build("Soy", null, null, modifiers);

    [Fact]
    public void AModifierAddsItsOwnAllergenToThePlate()
    {
        var plate = Curry(("Satay sauce", "Peanut", null, null));

        Assert.Equal(2, plate.Allergens.Count);
        Assert.Equal(new AllergenSource("Satay sauce", "Peanut"), plate.Allergens[1]);
    }

    [Fact]
    public void EachLineSaysWhereItCameFrom()
    {
        // "Contains peanut" leaves the customer nothing to do but put the dish down. "The satay
        // sauce contains peanut" tells them which box to untick.
        var plate = Curry(("Satay sauce", "Peanut", null, null));

        Assert.Equal(AllergenDisclosureBuilder.DishSource, plate.Allergens[0].Source);
        Assert.Equal("Satay sauce", plate.Allergens[1].Source);
    }

    [Fact]
    public void MayContainAndCrossContactTravelWithTheModifierToo()
    {
        var plate = Curry(("Satay sauce", null, "Tree nuts", "Made in a nut kitchen"));

        Assert.Equal(new AllergenSource("Satay sauce", "Tree nuts"), Assert.Single(plate.MayContain));
        Assert.Equal(new AllergenSource("Satay sauce", "Made in a nut kitchen"), Assert.Single(plate.CrossContact));
    }

    [Fact]
    public void AModifierThatDeclaresNothingAddsNothing()
    {
        // Silence is not a claim of safety, and it is not one here either: the dish's own panel
        // already tells the customer whether anything has been declared at all.
        var plate = Curry(("Steamed rice", null, null, null));

        Assert.Equal(AllergenDisclosureBuilder.DishSource, Assert.Single(plate.Allergens).Source);
    }

    [Fact]
    public void WhitespaceIsNotADeclaration()
    {
        var plate = AllergenDisclosureBuilder.Build("   ", null, null, [("Extra sauce", "  ", null, null)]);

        Assert.True(plate.IsEmpty);
    }

    [Fact]
    public void AnUnnamedModifierIsStillAttributedToSomething()
    {
        var plate = Curry(("   ", "Egg", null, null));

        Assert.Equal("A selected option", plate.Allergens[1].Source);
    }

    [Fact]
    public void EveryChosenModifierIsKept()
    {
        var plate = Curry(("Satay sauce", "Peanut", null, null), ("Fried egg", "Egg", null, null));

        Assert.Equal(["Soy", "Peanut", "Egg"], plate.Allergens.Select(line => line.Text));
    }

    [Fact]
    public void ADishWithNothingDeclaredStillReportsWhatAModifierBrings()
    {
        var plate = AllergenDisclosureBuilder.Build(null, null, null, [("Satay sauce", "Peanut", null, null)]);

        Assert.False(plate.IsEmpty);
        Assert.Equal("Peanut", Assert.Single(plate.Allergens).Text);
    }

    /// <summary>
    /// The declaration has to survive onto the order, or a receipt shows what the menu says today
    /// rather than what the customer was told.
    /// </summary>
    [Theory]
    [InlineData("OrderController.cs")]
    [InlineData("PublicCartsController.cs")]
    public void PlacingAnOrderFreezesTheModifierDeclaration(string controller)
    {
        var source = File.ReadAllText(ControllerPath(controller));

        Assert.Contains("AllergensSnapshot = option.Allergens", source, StringComparison.Ordinal);
        Assert.Contains("MayContainAllergensSnapshot = option.MayContainAllergens", source, StringComparison.Ordinal);
        Assert.Contains("CrossContactStatementSnapshot = option.CrossContactStatement", source, StringComparison.Ordinal);
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
