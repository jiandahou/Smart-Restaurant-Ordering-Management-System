namespace DineFlow.Api.Contracts.Order;

public sealed class CancelCustomerOrderRequest
{
    public string? Reason { get; set; }

    /// Required for orders placed without signing in. The order id alone is not a credential.
    public string? GuestAccessToken { get; set; }
}
