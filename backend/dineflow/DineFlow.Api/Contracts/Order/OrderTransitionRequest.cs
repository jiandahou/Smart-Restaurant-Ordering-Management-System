namespace DineFlow.Api.Contracts.Order;

public sealed class OrderTransitionRequest
{
    public string Action { get; init; } = string.Empty;

    public string? Reason { get; init; }

    /// <summary>
    /// Keeps the customer's money when the restaurant turns a paid order away.
    /// </summary>
    /// <remarks>
    /// The default refunds, because the opposite default is what left every paid rejected order on
    /// this deployment unrefunded. Skipping is for the case where the money has already been handed
    /// back another way — cash at the till, a refund raised in Stripe directly — and it has to be
    /// said deliberately, with a reason, so the exception is a decision on the record rather than
    /// something that happens by forgetting. Every action that can close an order already demands a
    /// reason, so the note explaining the exception is collected either way.
    /// </remarks>
    public bool SkipRefund { get; init; }
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
