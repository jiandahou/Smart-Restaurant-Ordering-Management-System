namespace DineFlow.Api.Contracts.Auth;

public sealed class UpdatePasskeyRequest
{
    public string? DeviceName { get; set; }

    public MfaVerificationRequest? Verification { get; set; }
}
