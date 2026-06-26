namespace DineFlow.Infrastructure.Menu;

public readonly record struct MenuOptionPriceSelection(
    OptionAdjustmentType AdjustmentType,
    decimal PriceAdjustment,
    int Quantity)
{
    public MenuOptionPriceSelection(MenuItemOption option, int quantity)
        : this(option.AdjustmentType, option.PriceAdjustment, quantity)
    {
    }
}

public static class PricingCalculator
{
    public static decimal CalculateUnitPrice(
        decimal basePrice,
        IEnumerable<MenuOptionPriceSelection> selectedOptions)
    {
        var unitPrice = basePrice;

        foreach (var selection in selectedOptions)
        {
            unitPrice = selection.AdjustmentType switch
            {
                OptionAdjustmentType.Add => unitPrice + selection.PriceAdjustment * selection.Quantity,
                OptionAdjustmentType.Remove => unitPrice + selection.PriceAdjustment * selection.Quantity,
                OptionAdjustmentType.Replace => selection.PriceAdjustment,
                _ => unitPrice
            };
        }

        return unitPrice;
    }

    public static decimal CalculateLineTotal(int quantity, decimal unitPrice) =>
        quantity * unitPrice;

    public static decimal CalculateTotal(IEnumerable<(int Quantity, decimal UnitPrice)> lines)
    {
        var total = 0m;

        foreach (var line in lines)
        {
            total += CalculateLineTotal(line.Quantity, line.UnitPrice);
        }

        return total;
    }

    public static long ToMinorCurrencyUnits(decimal amount) =>
        Convert.ToInt64(Math.Round(amount * 100m, MidpointRounding.AwayFromZero));
}
