namespace DineFlow.Api.Contracts.Auth;

public sealed class EnableTotpMfaRequest
{
    public string Code { get; set; } = string.Empty;
}
