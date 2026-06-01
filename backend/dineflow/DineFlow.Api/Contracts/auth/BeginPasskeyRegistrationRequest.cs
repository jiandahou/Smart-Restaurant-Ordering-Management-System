namespace DineFlow.Api.Contracts.Auth;

public sealed class BeginPasskeyRegistrationRequest
{
    public MfaVerificationRequest? Verification { get; set; }
}
