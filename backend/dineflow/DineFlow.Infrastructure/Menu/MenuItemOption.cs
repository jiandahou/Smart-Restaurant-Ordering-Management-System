namespace DineFlow.Infrastructure.Menu;

public enum OptionAdjustmentType
{
    Add,
    Remove,
    Replace
}

public class MenuItemOption
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid GroupId { get; set; }

    public Guid MenuItemId { get; set; }

    public Guid RestaurantId { get; set; }

    public string Name { get; set; } = string.Empty;

    public decimal PriceAdjustment { get; set; } = 0;

    public OptionAdjustmentType AdjustmentType { get; set; } = OptionAdjustmentType.Add;

    public int MaxQuantity { get; set; } = 1;

    /// <summary>
    /// How many of this modifier are left, or null when it is not counted.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A dish has stock and a modifier did not, so a limited-supply extra — the last of the day's
    /// truffle, a sauce made in one batch — could be sold indefinitely. The kitchen found out at the
    /// pass, one ticket at a time.
    /// </para>
    /// <para>
    /// Null means untracked, exactly as it does for a dish: most modifiers are unlimited and must not
    /// be made to carry a count nobody maintains.
    /// </para>
    /// <para>
    /// Counted in units of the modifier, not of the dish. Two spring rolls each taking three extra
    /// rolls consume six, and getting that multiplication wrong is how a tracked extra oversells
    /// while every individual line looks correct.
    /// </para>
    /// </remarks>
    public int? StockQuantity { get; set; }

    public int DisplayOrder { get; set; }

    /// <summary>
    /// What this modifier itself contains, declared separately from the dish.
    ///
    /// <para>
    /// A dish's allergen declaration describes the dish as listed. Adding satay sauce to a
    /// peanut-free curry changes what is on the plate, and the option had nowhere to say so — the
    /// panel the customer reads before ordering went on describing the dish without it. The
    /// disclosure has to travel with the thing being added, because only the option knows.
    /// </para>
    /// </summary>
    public string? Allergens { get; set; }

    /// <summary>Traces this modifier may carry, in the same sense as the dish's own field.</summary>
    public string? MayContainAllergens { get; set; }

    /// <summary>How this modifier is prepared and what it shares equipment with.</summary>
    public string? CrossContactStatement { get; set; }

    public bool IsAvailable { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public MenuItemOptionGroup? Group { get; set; }
}
