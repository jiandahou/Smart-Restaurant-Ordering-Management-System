namespace DineFlow.Api.Contracts.Menu;

public class CreateMenuOptionGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public bool IsRequired { get; set; } = false;
    public int MinSelections { get; set; } = 0;
    public int MaxSelections { get; set; } = 1;
    public int DisplayOrder { get; set; }
}

public class UpdateMenuOptionGroupRequest
{
    public string Name { get; set; } = string.Empty;
    public bool IsRequired { get; set; } = false;
    public int MinSelections { get; set; } = 0;
    public int MaxSelections { get; set; } = 1;
    public int DisplayOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class CreateMenuOptionRequest
{
    public string Name { get; set; } = string.Empty;
    public decimal PriceAdjustment { get; set; } = 0;
    public int AdjustmentType { get; set; } = 0; // 0=Add, 1=Remove, 2=Replace
    public int DisplayOrder { get; set; }
}

public class UpdateMenuOptionRequest
{
    public string Name { get; set; } = string.Empty;
    public decimal PriceAdjustment { get; set; } = 0;
    public int AdjustmentType { get; set; } = 0;
    public int DisplayOrder { get; set; }
    public bool IsAvailable { get; set; } = true;
}
