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
    /// <summary>
    /// The price of one plate with its chosen options applied.
    ///
    /// <para>
    /// An unrecognised adjustment type used to fall through to a default that left the price
    /// untouched, which read as a safe fallback and was not one. The customer's browser had no such
    /// default — an unknown type fell into its "add" branch — so one stored row produced +A$1.00 on
    /// the screen and nothing on the bill. Silently ignoring a rule you do not understand means
    /// charging a price nobody agreed to, so this now refuses to price the line at all.
    /// </para>
    /// </summary>
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
                _ => throw new ArgumentOutOfRangeException(
                    nameof(selectedOptions),
                    selection.AdjustmentType,
                    "This option has an adjustment type with no pricing rule, so its price cannot be "
                        + "calculated. The API rejects these on write and a check constraint keeps "
                        + "them out of the table; reaching this means one got in anyway.")
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
