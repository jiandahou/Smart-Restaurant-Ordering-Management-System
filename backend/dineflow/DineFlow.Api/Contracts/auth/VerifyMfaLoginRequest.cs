namespace DineFlow.Api.Contracts.Auth;

public sealed class VerifyMfaLoginRequest
{
    public string ChallengeId { get; set; } = string.Empty;

    public string Method { get; set; } = string.Empty;

    public string Code { get; set; } = string.Empty;
}
