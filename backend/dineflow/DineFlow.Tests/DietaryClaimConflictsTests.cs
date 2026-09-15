using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An item could be saved marked gluten free while its own allergen list read "wheat, gluten", or
/// marked vegan while listing milk and eggs, or vegan without being vegetarian. Nothing objected,
/// so the contradiction reached the customer, the receipt and the dietary filters.
/// </summary>
public sealed class DietaryClaimConflictsTests
{
    private static IReadOnlyList<string> Find(
        bool glutenFree = false, bool vegan = false, bool vegetarian = false, bool halal = false,
        string? allergens = null, string? mayContain = null) =>
        DietaryClaimConflicts.Find(glutenFree, vegan, vegetarian, halal, allergens, mayContain);

    [Fact]
    public void GlutenFreeBesideWheatIsReported()
    {
        var conflicts = Find(glutenFree: true, allergens: "小麦, 麸质");

        Assert.NotEmpty(conflicts);
        Assert.Contains("gluten free", conflicts[0], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("wheat flour")]
    [InlineData("Contains BARLEY")]
    [InlineData("面筋")]
    public void GlutenKeywordsAreMatchedInEitherLanguageAndAnyCase(string allergens)
    {
        Assert.NotEmpty(Find(glutenFree: true, allergens: allergens));
    }

    [Fact]
    public void VeganBesideMilkAndEggIsReported()
    {
        Assert.NotEmpty(Find(vegan: true, allergens: "牛奶, 鸡蛋"));
    }

    [Fact]
    public void VegetarianToleratesDairyButNotMeat()
    {
        // The distinction is the whole point of having two labels.
        Assert.Empty(Find(vegetarian: true, allergens: "milk, egg"));
        Assert.NotEmpty(Find(vegetarian: true, allergens: "beef"));
    }

    [Fact]
    public void HalalBesidePorkOrAlcoholIsReported()
    {
        Assert.NotEmpty(Find(halal: true, allergens: "pork"));
        Assert.NotEmpty(Find(halal: true, mayContain: "cooking wine"));
    }

    [Fact]
    public void TheMayContainTextIsCheckedToo()
    {
        // "May contain wheat" beside a gluten-free claim is exactly as dangerous as "contains".
        var conflicts = Find(glutenFree: true, mayContain: "may contain wheat");

        Assert.NotEmpty(conflicts);
        Assert.Contains("may contain", conflicts[0], StringComparison.Ordinal);
    }

    [Fact]
    public void AnUnclaimedLabelIsNeverReported()
    {
        // An item that never claimed to be gluten free may say whatever it likes about wheat.
        Assert.Empty(Find(allergens: "wheat, gluten, milk, pork"));
    }

    [Fact]
    public void AgreeingClaimsAndAllergensProduceNothing()
    {
        Assert.Empty(Find(glutenFree: true, vegan: true, vegetarian: true, allergens: "花生", mayContain: "坚果"));
    }

    [Fact]
    public void EmptyAllergenTextProducesNothing()
    {
        Assert.Empty(Find(glutenFree: true, vegan: true, allergens: null, mayContain: "   "));
    }

    [Fact]
    public void EveryConflictNamesTheClaimAndTheWordThatContradictsIt()
    {
        // The person confirming needs to see which word triggered it, or they cannot judge it.
        var conflicts = Find(glutenFree: true, allergens: "contains wheat flour");

        Assert.Contains("wheat", conflicts[0], StringComparison.Ordinal);
    }

    [Fact]
    public void VeganAlwaysImpliesVegetarian()
    {
        // Not a judgement call: there is no dish that is vegan and not vegetarian.
        Assert.True(DietaryClaimConflicts.ResolveVegetarian(isVegan: true, isVegetarian: false));
        Assert.True(DietaryClaimConflicts.ResolveVegetarian(isVegan: true, isVegetarian: true));
    }

    [Fact]
    public void VegetarianAloneIsLeftAsItIs()
    {
        Assert.True(DietaryClaimConflicts.ResolveVegetarian(isVegan: false, isVegetarian: true));
        Assert.False(DietaryClaimConflicts.ResolveVegetarian(isVegan: false, isVegetarian: false));
    }
}
