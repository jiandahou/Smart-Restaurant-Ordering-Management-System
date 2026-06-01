namespace DineFlow.Api.Contracts.Auth;

public sealed class EnableEmailMfaRequest
{
    public string Code { get; set; } = string.Empty;
}
