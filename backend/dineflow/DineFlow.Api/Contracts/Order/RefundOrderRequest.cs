namespace DineFlow.Api.Contracts.Order;

public sealed class RefundOrderRequest
{
    public string? Reason { get; set; }

    public long? AmountCents { get; set; }
}
