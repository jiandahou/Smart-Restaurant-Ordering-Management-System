namespace DineFlow.Api.Contracts.Order;

public sealed class RefundOrderRequest
{
    public string? Reason { get; set; }

    public long? AmountCents { get; set; }

    public long? GeneralAdjustmentAmountCents { get; set; }

    public List<RefundOrderItemRequest> Items { get; set; } = [];
}

public sealed class RefundOrderItemRequest
{
    public Guid OrderItemId { get; set; }

    public int Quantity { get; set; }

    public long AmountCents { get; set; }
}
