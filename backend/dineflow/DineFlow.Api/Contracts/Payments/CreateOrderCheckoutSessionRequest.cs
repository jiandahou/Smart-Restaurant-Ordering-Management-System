namespace DineFlow.Api.Contracts.Payments;

public sealed class CreateOrderCheckoutSessionRequest
{
    public Guid OrderId { get; set; }

    public string? ReturnTo { get; set; }
}
