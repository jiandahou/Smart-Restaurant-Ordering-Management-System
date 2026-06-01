namespace DineFlow.Api.Contracts.Auth;

public sealed class DeletePasskeyRequest
{
    public MfaVerificationRequest? Verification { get; set; }
}
