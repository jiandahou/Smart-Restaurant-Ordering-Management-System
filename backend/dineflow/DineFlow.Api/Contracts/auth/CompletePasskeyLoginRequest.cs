using Fido2NetLib;

namespace DineFlow.Api.Contracts.Auth;

public sealed class CompletePasskeyLoginRequest
{
    public string Challenge { get; set; } = string.Empty;

    public AuthenticatorAssertionRawResponse AssertionResponse { get; set; } = null!;
}
