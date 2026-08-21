namespace DineFlow.Api.Contracts.Menu;

public class UpdateMenuItemRequest
{
    public Guid CategoryId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal Price { get; set; }
    public string? ImageUrl { get; set; }
    public bool IsAvailable { get; set; }
    public bool IsSoldOut { get; set; }
    public bool IsVegetarian { get; set; }
    public bool IsVegan { get; set; }
    public bool IsGlutenFree { get; set; }
    public bool IsHalal { get; set; }
    public string? Allergens { get; set; }
    public string? MayContainAllergens { get; set; }
    public string? CrossContactStatement { get; set; }
    public int SpiceLevel { get; set; }
    public string? ServingSize { get; set; }
    public int? Calories { get; set; }
    public bool IsPopular { get; set; }
    public bool IsRecommended { get; set; }
    public int DisplayOrder { get; set; }

    /// <summary>
    /// The person saving has looked at the contradictions between the dietary claims and the
    /// allergen text and says they are correct. Without it a contradicting item is refused, so the
    /// claim and the allergen list can never disagree by accident.
    /// </summary>
    public bool AcknowledgeDietaryConflicts { get; set; }

    /// <summary>
    /// The item's version as it stood when the form was opened, so a save built on a stale copy can
    /// be recognised.
    ///
    /// <para>
    /// An update carries every field, so two people editing one item do not each save their own
    /// change — the second one saves their change plus the first one's fields as they were before,
    /// silently reverting them. Required rather than optional: a check the caller can leave out is
    /// one nobody can rely on.
    /// </para>
    /// </summary>
    public DateTime? ExpectedUpdatedAt { get; set; }

    /// <summary>
    /// Save anyway, having been shown what the other person changed. This is what makes the
    /// conflict a decision rather than a dead end.
    /// </summary>
    public bool OverwriteConflict { get; set; }
}
