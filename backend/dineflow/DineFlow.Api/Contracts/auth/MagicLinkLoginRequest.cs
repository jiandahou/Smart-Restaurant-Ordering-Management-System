namespace DineFlow.Api.Contracts.Auth;

public class MagicLinkLoginRequest
{
    public string UserId { get; set; } = string.Empty;

    public string Token { get; set; } = string.Empty;
}
