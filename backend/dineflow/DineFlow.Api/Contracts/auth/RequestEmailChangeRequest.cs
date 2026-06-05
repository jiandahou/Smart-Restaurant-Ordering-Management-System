namespace DineFlow.Api.Contracts.Auth;

public class RequestEmailChangeRequest
{
    public string NewEmail { get; set; } = string.Empty;

    public string CurrentPassword { get; set; } = string.Empty;
}
