namespace DineFlow.Api.Contracts.Auth;

public sealed class UpdateMfaSettingsRequest
{
    public bool RequireForLogin { get; set; }

    public bool RequireForPayment { get; set; }

    public bool RequireForSensitiveActions { get; set; }
}
