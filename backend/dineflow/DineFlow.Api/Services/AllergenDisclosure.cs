namespace DineFlow.Api.Services;

/// <summary>
/// One line of allergen disclosure and where it came from.
/// </summary>
/// <param name="Source">The dish, or the name of the modifier that carries it.</param>
/// <param name="Text">The wording the restaurant supplied, verbatim.</param>
public readonly record struct AllergenSource(string Source, string Text);

/// <summary>
/// Everything declared about a plate as it was actually ordered, dish and modifiers together.
/// </summary>
public sealed class AllergenDisclosure
{
    /// <summary>Named where each line came from, because "contains peanut" and "the satay sauce
    /// contains peanut" lead to different decisions — the second one can be removed.</summary>
    public IReadOnlyList<AllergenSource> Allergens { get; init; } = [];

    public IReadOnlyList<AllergenSource> MayContain { get; init; } = [];

    public IReadOnlyList<AllergenSource> CrossContact { get; init; } = [];

    /// <summary>True when nobody has declared anything at all, dish or modifier.</summary>
    public bool IsEmpty => Allergens.Count == 0 && MayContain.Count == 0 && CrossContact.Count == 0;
}

/// <summary>
/// Combines a dish's allergen declaration with those of the modifiers chosen for it.
///
/// <para>
/// A dish's declaration describes the dish as listed. Options had nowhere to record their own, so
/// adding satay sauce to a curry declared peanut-free left the panel the customer reads before
/// ordering saying exactly what it said before — the addition was invisible to the one check a
/// customer with an allergy actually performs.
/// </para>
///
/// <para>
/// The lines are kept separate and attributed rather than merged into one string. A customer who
/// reads "contains peanut (Satay sauce)" can deselect the sauce; one who reads "contains peanut"
/// can only put the dish down.
/// </para>
/// </summary>
public static class AllergenDisclosureBuilder
{
    /// <summary>How a dish names itself in an attribution.</summary>
    public const string DishSource = "This dish";

    /// <summary>
    /// The disclosure for a plate. Modifier lines follow the dish's, in the order chosen.
    /// </summary>
    /// <param name="modifiers">
    /// Name, allergens, may-contain and cross-contact for each selected option. A modifier that
    /// declares nothing contributes nothing — silence is not a claim of safety here, because the
    /// dish's own "not declared" already tells the customer the information is missing.
    /// </param>
    public static AllergenDisclosure Build(
        string? itemAllergens,
        string? itemMayContain,
        string? itemCrossContact,
        IEnumerable<(string Name, string? Allergens, string? MayContain, string? CrossContact)> modifiers)
    {
        var allergens = new List<AllergenSource>();
        var mayContain = new List<AllergenSource>();
        var crossContact = new List<AllergenSource>();

        Append(allergens, DishSource, itemAllergens);
        Append(mayContain, DishSource, itemMayContain);
        Append(crossContact, DishSource, itemCrossContact);

        foreach (var modifier in modifiers)
        {
            var name = string.IsNullOrWhiteSpace(modifier.Name) ? "A selected option" : modifier.Name.Trim();

            Append(allergens, name, modifier.Allergens);
            Append(mayContain, name, modifier.MayContain);
            Append(crossContact, name, modifier.CrossContact);
        }

        return new AllergenDisclosure
        {
            Allergens = allergens,
            MayContain = mayContain,
            CrossContact = crossContact
        };
    }

    private static void Append(List<AllergenSource> lines, string source, string? text)
    {
        if (!string.IsNullOrWhiteSpace(text))
        {
            lines.Add(new AllergenSource(source, text.Trim()));
        }
    }
}
