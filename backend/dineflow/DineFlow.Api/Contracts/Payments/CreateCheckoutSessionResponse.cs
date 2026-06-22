namespace DineFlow.Api.Contracts.Payments;

public sealed class CreateCheckoutSessionResponse
{
    public string Message { get; set; } = string.Empty;

    public string SessionId { get; set; } = string.Empty;

    public string CheckoutUrl { get; set; } = string.Empty;

    public Guid OrderId { get; set; }

    public Guid PaymentId { get; set; }
}
