namespace DineFlow.Api.Contracts.Email;

public class SendTestEmailRequest
{
    public string To { get; set; } = string.Empty;

    public string? Subject { get; set; }

    public string? Message { get; set; }
}
