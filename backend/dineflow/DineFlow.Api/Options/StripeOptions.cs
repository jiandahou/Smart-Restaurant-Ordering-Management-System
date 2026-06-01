namespace DineFlow.Api.Options;

public sealed class StripeOptions
{
    public const string SectionName = "Stripe";

    public string SecretKey { get; set; } = string.Empty;

    public string PublishableKey { get; set; } = string.Empty;

    public string WebhookSecret { get; set; } = string.Empty;

    public string Currency { get; set; } = "aud";

    public string SuccessUrl { get; set; } = string.Empty;

    public string CancelUrl { get; set; } = string.Empty;
}
