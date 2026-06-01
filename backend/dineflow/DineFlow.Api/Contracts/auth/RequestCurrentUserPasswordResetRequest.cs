namespace DineFlow.Api.Contracts.Auth;

public sealed class RequestCurrentUserPasswordResetRequest
{
    public string Password { get; set; } = string.Empty;

    public MfaVerificationRequest? Verification { get; set; }
}
