namespace DineFlow.Api.Options;

public sealed class PasskeyOptions
{
    public const string SectionName = "Passkeys";

    public string ServerDomain { get; set; } = "localhost";

    public string ServerName { get; set; } = "DineFlow";

    public string[] Origins { get; set; } = ["http://localhost:5173"];
}
