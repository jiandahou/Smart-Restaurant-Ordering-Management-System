namespace DineFlow.Api.Contracts.Order;

public sealed class CreateRefundRequestRequest
{
    public string? Reason { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }
}

public sealed class CustomerRefundRequestResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public string Status { get; set; } = string.Empty;

    public long RequestedAmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public string? AdminNote { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? ReviewedAt { get; set; }
}
