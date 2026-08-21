namespace DineFlow.Api.Services;

/// <summary>
/// Validation for Australian Business Numbers.
///
/// <para>
/// An ABN is eleven digits carrying a check on itself, so an obviously fabricated number such as
/// <c>12345678901</c> can be rejected before it reaches a receipt or a tax invoice. Length alone
/// cannot tell the two apart, which is how that value reached a live restaurant record.
/// </para>
///
/// <para>
/// A passing checksum only means the number is well-formed — it does not mean the ABN is
/// registered, active, or belongs to the business claiming it. Confirming that is a manual step
/// against the Australian Business Register.
/// </para>
/// </summary>
public static class AustralianBusinessNumber
{
    public const int DigitCount = 11;

    /// <summary>ATO weighting: the first digit is reduced by one before the weighted sum.</summary>
    private static readonly int[] Weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

    /// <summary>Digits only, so "51 824 753 556" and "51-824-753-556" normalise to the same value.</summary>
    public static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var digits = new string(value.Where(char.IsAsciiDigit).ToArray());
        return digits.Length == 0 ? null : digits;
    }

    public static bool HasValidLength(string? value) =>
        Normalize(value)?.Length == DigitCount;

    /// <summary>True when the value is eleven digits and satisfies the ABN check.</summary>
    public static bool IsValid(string? value)
    {
        var digits = Normalize(value);

        if (digits is null || digits.Length != DigitCount)
        {
            return false;
        }

        var total = 0;
        for (var index = 0; index < Weights.Length; index++)
        {
            var digit = digits[index] - '0' - (index == 0 ? 1 : 0);
            total += digit * Weights[index];
        }

        return total % 89 == 0;
    }

    /// <summary>Grouped for display as the ABR prints it: "51 824 753 556".</summary>
    public static string? Format(string? value)
    {
        var digits = Normalize(value);

        return digits?.Length == DigitCount
            ? $"{digits[..2]} {digits[2..5]} {digits[5..8]} {digits[8..]}"
            : digits;
    }
}
