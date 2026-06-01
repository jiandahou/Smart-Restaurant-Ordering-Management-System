namespace DineFlow.Api.Contracts.Auth;

public sealed class ExchangeOAuthCodeRequest
{
    public string Code { get; set; } = string.Empty;
}
