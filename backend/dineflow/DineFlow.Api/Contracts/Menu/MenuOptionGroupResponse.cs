namespace DineFlow.Api.Contracts.Menu;

public class MenuOptionGroupResponse
{
    public Guid Id { get; set; }
    public Guid MenuItemId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsRequired { get; set; }
    public int MinSelections { get; set; }
    public int MaxSelections { get; set; }
    public int DisplayOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public List<MenuOptionResponse> Options { get; set; } = new();
}

public class MenuOptionResponse
{
    public Guid Id { get; set; }
    public Guid GroupId { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal PriceAdjustment { get; set; }
    public int AdjustmentType { get; set; }
    public int MaxQuantity { get; set; }

    /// <summary>
    /// Units of this modifier left, or null when it is not counted.
    /// </summary>
    /// <remarks>
    /// Published for the same reason a dish's count is: a modifier with one left looked exactly like
    /// an unlimited one, so a customer could choose it, work through the rest of the order, and only
    /// be turned away at checkout with nothing having warned them.
    /// </remarks>
    public int? RemainingStock { get; set; }
    public int DisplayOrder { get; set; }
    /// <summary>The modifier's own allergen declaration, separate from the dish's.</summary>
    public string? Allergens { get; set; }
    public string? MayContainAllergens { get; set; }
    public string? CrossContactStatement { get; set; }
    public bool IsAvailable { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
