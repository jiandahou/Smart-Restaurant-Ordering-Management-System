namespace DineFlow.Api.Contracts.Auth;

public sealed class UpdateMfaSettingsRequest
{
    public bool RequireForLogin { get; set; }

    // No payment scope: nothing ever enforced one. The column survives so an operator can see what
    // an account used to have; see MfaController for why it is no longer offered.

    public bool RequireForSensitiveActions { get; set; }
}
