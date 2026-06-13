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
    public int DisplayOrder { get; set; }
    public bool IsAvailable { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
