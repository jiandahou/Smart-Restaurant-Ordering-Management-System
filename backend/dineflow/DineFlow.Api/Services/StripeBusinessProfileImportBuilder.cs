using DineFlow.Api.Contracts.Restaurant;
using Stripe;

namespace DineFlow.Api.Services;

public static class StripeBusinessProfileImportBuilder
{
    /// <summary>Stripe's tax ID type for an Australian Business Number.</summary>
    private const string AustralianBusinessNumberType = "au_abn";

    public static StripeBusinessProfileImportResponse Build(
        Account account,
        IEnumerable<TaxId>? accountTaxIds = null)
    {
        ArgumentNullException.ThrowIfNull(account);

        var suggestions = new List<StripeBusinessProfileSuggestionResponse>();
        var businessName = Normalize(account.BusinessProfile?.Name);
        var legalName = Normalize(account.Company?.Name) ?? BuildIndividualName(account.Individual) ?? businessName;
        var (address, addressSource) = FirstAvailable(
            (FormatAddress(account.Company?.Address), "Stripe legal entity address"),
            (FormatAddress(account.BusinessProfile?.SupportAddress), "Stripe public support address"),
            (FormatAddress(account.Individual?.Address), "Stripe individual address"));
        var (phone, phoneSource) = FirstAvailable(
            (Normalize(account.BusinessProfile?.SupportPhone), "Stripe public support phone"),
            (Normalize(account.Company?.Phone), "Stripe legal entity phone"),
            (Normalize(account.Individual?.Phone), "Stripe individual phone"));
        var (email, emailSource) = FirstAvailable(
            (Normalize(account.BusinessProfile?.SupportEmail), "Stripe public support email"),
            (Normalize(account.Email), "Stripe account email"),
            (Normalize(account.Individual?.Email), "Stripe individual email"));

        var abn = ResolveAustralianBusinessNumber(accountTaxIds);

        Add(suggestions, "name", "Restaurant name", businessName, "Stripe business profile");
        Add(suggestions, "legalBusinessName", "Legal business name", legalName,
            Normalize(account.Company?.Name) is not null ? "Stripe legal entity" : "Stripe account holder");
        Add(suggestions, "abn", "ABN", abn, "Stripe account tax ID (au_abn)");
        Add(suggestions, "address", "Address", address, addressSource);
        Add(suggestions, "phone", "Phone", phone, phoneSource);
        Add(suggestions, "businessContactEmail", "Business contact email", email, emailSource);
        Add(suggestions, "refundContactEmail", "Refund contact email", email, emailSource);
        Add(suggestions, "countryCode", "Country", Normalize(account.Country)?.ToUpperInvariant(), "Stripe account");
        Add(suggestions, "currency", "Currency", Normalize(account.DefaultCurrency)?.ToUpperInvariant(), "Stripe account");

        var taxIdProvided = account.Company?.TaxIdProvided == true;

        return new StripeBusinessProfileImportResponse
        {
            RetrievedAt = DateTime.UtcNow,
            TaxIdProvided = taxIdProvided || abn is not null,
            TaxIdStatus = abn is not null
                ? StripeBusinessTaxIdStatus.Imported
                : taxIdProvided
                    ? StripeBusinessTaxIdStatus.ProvidedButHidden
                    : StripeBusinessTaxIdStatus.Missing,
            Suggestions = suggestions
        };
    }

    /// <summary>
    /// Stripe redacts <c>company.tax_id</c> on the Account object, so a readable ABN can only come
    /// from the connected account's own tax IDs. Verified registrations win over unverified ones.
    /// </summary>
    private static string? ResolveAustralianBusinessNumber(IEnumerable<TaxId>? accountTaxIds) =>
        (accountTaxIds ?? [])
            .Where(taxId => string.Equals(taxId?.Type, AustralianBusinessNumberType, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(taxId => string.Equals(
                taxId.Verification?.Status,
                "verified",
                StringComparison.OrdinalIgnoreCase))
            .Select(taxId => NormalizeAbn(taxId.Value))
            .FirstOrDefault(value => value is not null);

    /// Shares AustralianBusinessNumber with the restaurant form, so an ABN Stripe hands back is
    /// held to exactly the same standard as one typed in by hand.
    private static string? NormalizeAbn(string? value) =>
        AustralianBusinessNumber.IsValid(value) ? AustralianBusinessNumber.Normalize(value) : null;

    private static string? BuildIndividualName(Person? individual)
    {
        if (individual is null)
        {
            return null;
        }

        return Normalize(string.Join(' ', new[] { individual.FirstName, individual.LastName }
            .Where(value => !string.IsNullOrWhiteSpace(value))));
    }

    private static string? FormatAddress(Address? address)
    {
        if (address is null)
        {
            return null;
        }

        var locality = string.Join(' ', new[] { address.City, address.State, address.PostalCode }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim()));

        return Normalize(string.Join(", ", new[] { address.Line1, address.Line2, locality }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!.Trim())));
    }

    private static (string? Value, string Source) FirstAvailable(
        params (string? Value, string Source)[] candidates) =>
        candidates.FirstOrDefault(candidate => !string.IsNullOrWhiteSpace(candidate.Value));

    private static void Add(
        ICollection<StripeBusinessProfileSuggestionResponse> suggestions,
        string field,
        string label,
        string? value,
        string source)
    {
        value = Normalize(value);
        if (value is null)
        {
            return;
        }

        suggestions.Add(new StripeBusinessProfileSuggestionResponse
        {
            Field = field,
            Label = label,
            Value = value,
            Source = source
        });
    }

    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
