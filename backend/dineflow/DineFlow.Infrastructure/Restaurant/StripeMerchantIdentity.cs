namespace DineFlow.Infrastructure.Restaurant;

/// <summary>
/// Whether the Stripe account a restaurant is connected to presents itself as that restaurant.
/// </summary>
/// <remarks>
/// <para>
/// Stripe Checkout puts the connected account's own business profile name at the top of the page —
/// not anything DineFlow sends with the session. So an order from The DineFlow Kitchen was taken on
/// a page headed <i>Central Market Table</i>, because that is what was typed into that account's
/// profile at onboarding. The accounts were not crossed and the money reached the right one; what
/// was wrong was the only part the customer could see.
/// </para>
/// <para>
/// Nothing here could have noticed. The platform read the account's capabilities and requirements
/// and never once read what it was called, so no screen and no gate had the fact available to check.
/// </para>
/// <para>
/// A customer who does not recognise the merchant on their statement disputes the charge, and a
/// dispute costs the restaurant the money and the fee. This is worth catching before the first sale,
/// not after the first chargeback.
/// </para>
/// </remarks>
public static class StripeMerchantIdentity
{
    /// <summary>
    /// How the restaurant should be recognised: its trading name, or the legal name it trades under.
    /// </summary>
    public static bool Matches(string? stripeProfileName, string? restaurantName, string? legalBusinessName)
    {
        if (string.IsNullOrWhiteSpace(stripeProfileName))
        {
            // Nothing to disagree with yet. An account that has not said who it is is covered by the
            // ordinary onboarding requirements, not by this.
            return true;
        }

        return Same(stripeProfileName, restaurantName) || Same(stripeProfileName, legalBusinessName);
    }

    /// <summary>What to tell whoever has to fix it, or null when there is nothing to fix.</summary>
    public static string? Describe(string? stripeProfileName, string? restaurantName, string? legalBusinessName)
    {
        if (Matches(stripeProfileName, restaurantName, legalBusinessName))
        {
            return null;
        }

        return $"Stripe shows this restaurant to customers as \"{stripeProfileName?.Trim()}\". "
            + $"Card pages and statements will not say \"{restaurantName?.Trim()}\", which customers "
            + "dispute when they do not recognise it. Correct the business name on the connected "
            + "Stripe account.";
    }

    /// <summary>
    /// Compared loosely on purpose: punctuation, casing and the trading-name suffixes people type
    /// differ between the two systems without meaning anything. A wholly different business is what
    /// this is looking for.
    /// </summary>
    private static bool Same(string? left, string? right)
    {
        var a = Normalize(left);
        var b = Normalize(right);

        return a.Length > 0 && b.Length > 0 && (a == b || a.Contains(b) || b.Contains(a));
    }

    private static string Normalize(string? value) =>
        new((value ?? string.Empty)
            .ToLowerInvariant()
            .Where(character => char.IsLetterOrDigit(character))
            .ToArray());
}
