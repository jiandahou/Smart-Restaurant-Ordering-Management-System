namespace DineFlow.Api.Contracts.Order;

public sealed class CreateRefundRequestRequest
{
    public string? Reason { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public List<CreateRefundRequestItemInput> Items { get; set; } = [];

    /// Required for orders placed without signing in. The order id alone is not a credential.
    public string? GuestAccessToken { get; set; }
}

public sealed class CreateRefundRequestItemInput
{
    public Guid OrderItemId { get; set; }

    /// <summary>
    /// One extra on that line, when the refund is for the extra rather than the dish.
    /// </summary>
    /// <remarks>
    /// Null asks for the line as a whole, which is what every request meant before extras could be
    /// named. A line is refunded one way or the other and never both, so a request naming an extra
    /// on a line already refunded whole — or the reverse — is refused rather than merged.
    /// </remarks>
    public Guid? OrderItemOptionId { get; set; }

    public int Quantity { get; set; }

    /// Exact amount requested against this order line. Null keeps older clients working by
    /// using UnitPrice * Quantity.
    public long? AmountCents { get; set; }
}

public sealed class CustomerRefundRequestResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public string Status { get; set; } = string.Empty;

    public long RequestedAmountCents { get; set; }

    /// What was actually sent to the payment provider. Null until a refund has been created.
    /// May be less than RequestedAmountCents when staff approve a partial refund.
    public long? RefundedAmountCents { get; set; }

    /// Status of the actual refund (Pending / Succeeded / Failed), null when none exists yet.
    public string? RefundStatus { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public string? AdminNote { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public List<CustomerRefundRequestItemResponse> Items { get; set; } = [];
}

public sealed class CustomerRefundRequestItemResponse
{
    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    /// <summary>The extra this line of the request is for, when it is for one.</summary>
    public string? OptionNameSnapshot { get; set; }

    public int Quantity { get; set; }

    public long AmountCents { get; set; }
}
