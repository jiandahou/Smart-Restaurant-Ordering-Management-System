namespace DineFlow.Api.Contracts.Payments;

public sealed class CreateOrderCheckoutSessionRequest
{
    public Guid OrderId { get; set; }

    public string? ReturnTo { get; set; }

    /// <summary>
    /// The token issued when a guest placed this order, proving the caller is the customer whose
    /// order it is. Every other guest-reachable order route asks for it; this one did not, so an
    /// order id on its own was enough to start a payment for somebody else's order.
    /// </summary>
    public string? GuestAccessToken { get; set; }
}
