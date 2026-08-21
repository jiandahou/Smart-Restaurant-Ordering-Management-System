namespace DineFlow.Api.Options;

public sealed class ComplianceOptions
{
    public const string SectionName = "Compliance";
    public string OperatorName { get; set; } = string.Empty;
    public string OperatorAbn { get; set; } = string.Empty;
    public string OperatorAddress { get; set; } = string.Empty;
    public string PrivacyEmail { get; set; } = string.Empty;
    public string SupportEmail { get; set; } = string.Empty;
}
