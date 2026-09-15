namespace DineFlow.Api.Contracts.Order;

/// <summary>
/// Changes how an order that has not been paid for yet is going to be settled.
/// </summary>
/// <remarks>
/// Addressed by order rather than by cart. The cart that produced the order is submitted and its
/// participant token is often long gone from the browser, which used to leave a customer with no
/// route back to this choice at all.
/// </remarks>
public sealed class ChangeOrderPaymentMethodRequest
{
    /// <summary>Either <c>Online</c> or <c>PayAtCounter</c>.</summary>
    public string? PaymentMethod { get; set; }

    /// Required for orders placed without signing in. The order id alone is not a credential.
    public string? GuestAccessToken { get; set; }
}
