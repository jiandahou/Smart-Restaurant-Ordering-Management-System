namespace DineFlow.Api.Contracts.Auth;

public class ConfirmEmailChangeRequest
{
    public string UserId { get; set; } = string.Empty;

    public string NewEmail { get; set; } = string.Empty;

    public string Token { get; set; } = string.Empty;
}
