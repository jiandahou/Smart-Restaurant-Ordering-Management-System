using Fido2NetLib;

namespace DineFlow.Api.Contracts.Auth;

public sealed class CompletePasskeyRegistrationRequest
{
    public string? DeviceName { get; set; }

    public AuthenticatorAttestationRawResponse AttestationResponse { get; set; } = null!;
}
