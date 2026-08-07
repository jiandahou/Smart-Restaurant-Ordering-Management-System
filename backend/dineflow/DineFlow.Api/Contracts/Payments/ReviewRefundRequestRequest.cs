namespace DineFlow.Api.Contracts.Payments;

public sealed class ReviewRefundRequestRequest
{
    public string? Note { get; set; }

    public long? AmountCents { get; set; }
}
