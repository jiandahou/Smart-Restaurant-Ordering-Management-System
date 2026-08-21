namespace DineFlow.Api.Contracts.Restaurant;

public sealed class StripeBusinessProfileImportResponse
{
    public DateTime RetrievedAt { get; set; }

    public bool TaxIdProvided { get; set; }

    /// <summary>
    /// "Imported" when Stripe returned a readable business tax ID, "ProvidedButHidden" when Stripe
    /// only confirms one was supplied, "Missing" when the connected account has none.
    /// </summary>
    public string TaxIdStatus { get; set; } = StripeBusinessTaxIdStatus.Missing;

    public IReadOnlyList<StripeBusinessProfileSuggestionResponse> Suggestions { get; set; } = [];
}

public static class StripeBusinessTaxIdStatus
{
    public const string Imported = "Imported";

    public const string ProvidedButHidden = "ProvidedButHidden";

    public const string Missing = "Missing";
}

public sealed class StripeBusinessProfileSuggestionResponse
{
    public string Field { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;

    public string Source { get; set; } = string.Empty;
}
