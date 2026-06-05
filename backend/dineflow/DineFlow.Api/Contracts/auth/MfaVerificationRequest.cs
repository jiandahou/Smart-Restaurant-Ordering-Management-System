namespace DineFlow.Api.Contracts.Auth;

public sealed class MfaVerificationRequest
{
    public string Method { get; set; } = string.Empty;

    public string Code { get; set; } = string.Empty;
}
