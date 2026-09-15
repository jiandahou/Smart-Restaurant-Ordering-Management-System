namespace DineFlow.Api.Services;

/// <summary>
/// How finely a price is allowed to be divided, and whether DineFlow can price in a currency at all.
///
/// <para>
/// A price only had a range check, so A$9.999 was accepted and stored exactly as written. Nothing
/// downstream could carry it: the order line column holds two decimals and rounded it to 10.00 on
/// insert, the order total column held the unrounded 29.997 for three of them, and Stripe was sent
/// 1000 minor units per unit — three different answers to what one plate costs. The customer paid
/// A$30.00 against an order that recorded A$29.997, and the difference sat in revenue reports where
/// nothing would ever explain it.
/// </para>
///
/// <para>
/// The fix is to refuse the price at the door, because there is no correct place to round it later.
/// Rounding at checkout would charge a price nobody set; rounding at save would silently change what
/// the restaurant typed. Only the person entering the price can say whether they meant 9.99 or 10.00.
/// </para>
/// </summary>
public static class CurrencyPrecision
{
    /// <summary>
    /// What the money path is built for, end to end: two decimals in every column, and
    /// <c>PricingCalculator.ToMinorCurrencyUnits</c> multiplying by exactly 100.
    /// </summary>
    public const int SupportedDecimalPlaces = 2;

    /// <summary>ISO 4217 currencies with no minor unit at all — ¥100 is 100 minor units, not 10,000.</summary>
    private static readonly HashSet<string> WithoutMinorUnit = new(StringComparer.OrdinalIgnoreCase)
    {
        "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF",
        "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"
    };

    /// <summary>ISO 4217 currencies whose minor unit is a thousandth.</summary>
    private static readonly HashSet<string> WithThousandthUnit = new(StringComparer.OrdinalIgnoreCase)
    {
        "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"
    };

    /// <summary>Decimal places in the currency's smallest real unit. Two for most of the world.</summary>
    public static int DecimalPlaces(string? currency)
    {
        var code = currency?.Trim();

        if (string.IsNullOrEmpty(code))
        {
            return SupportedDecimalPlaces;
        }

        if (WithoutMinorUnit.Contains(code))
        {
            return 0;
        }

        return WithThousandthUnit.Contains(code) ? 3 : SupportedDecimalPlaces;
    }

    /// <summary>
    /// True when an amount can be paid in this currency — no fraction of a cent left over.
    /// </summary>
    public static bool IsRepresentable(decimal amount, string? currency) =>
        amount == decimal.Round(amount, DecimalPlaces(currency));

    /// <summary>
    /// The reason an amount cannot be used as a price, or null when it can.
    /// </summary>
    /// <param name="label">How to name the field to the person who typed it, e.g. "Price".</param>
    public static string? DescribeProblem(decimal amount, string? currency, string label)
    {
        var code = string.IsNullOrWhiteSpace(currency) ? "AUD" : currency.Trim().ToUpperInvariant();
        var places = DecimalPlaces(code);

        // Every column and every conversion in the money path assumes hundredths. A currency that
        // does not work that way needs more than a validation rule, so say so rather than accept a
        // price that would be charged at a hundred times its value.
        if (places != SupportedDecimalPlaces)
        {
            return $"DineFlow cannot price in {code} yet: its smallest unit is not 1/100. "
                + "Set the restaurant to a currency with cents before adding prices.";
        }

        if (!IsRepresentable(amount, code))
        {
            return $"{label} must not be finer than a cent — {code} has {places} decimal places, "
                + $"so {amount} cannot be charged or refunded exactly.";
        }

        return null;
    }
}
