namespace DineFlow.Api.Options;

public sealed class EmailOptions
{
    public const string SectionName = "Email";

    public string? From { get; set; }

    public string? Server { get; set; }

    public string? ResendApiKey { get; set; }

    public string? FrontendBaseUrl { get; set; }
}
