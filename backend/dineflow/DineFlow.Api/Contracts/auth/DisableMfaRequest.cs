namespace DineFlow.Api.Contracts.Auth;

public sealed class DisableMfaRequest
{
    public string Method { get; set; } = string.Empty;

    public MfaVerificationRequest? Verification { get; set; }
}
