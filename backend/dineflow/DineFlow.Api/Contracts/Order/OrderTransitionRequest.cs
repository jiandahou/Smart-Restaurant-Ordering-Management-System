namespace DineFlow.Api.Contracts.Order;

public sealed class OrderTransitionRequest
{
    public string Action { get; init; } = string.Empty;

    public string? Reason { get; init; }
}

public sealed class OrderStatusHistoryResponse
{
    public Guid Id { get; init; }

    public string PreviousStatus { get; init; } = string.Empty;

    public string NewStatus { get; init; } = string.Empty;

    public string? Action { get; init; }

    public string? Reason { get; init; }

    public string? ChangedByUserId { get; init; }

    public DateTime CreatedAt { get; init; }
}
