namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundRequestResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid PaymentId { get; set; }

    public Guid? PaymentRefundId { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string Status { get; set; } = string.Empty;

    public long RequestedAmountCents { get; set; }

    public long OriginalPaymentAmountCents { get; set; }

    public long AlreadyRefundedAmountCents { get; set; }

    public long RefundableAmountCents { get; set; }

    public int PreviousRefundCount { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? Reason { get; set; }

    public string? AdminNote { get; set; }

    public string? RequestedByUserId { get; set; }

    public string? ReviewedByUserId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? ReviewedAt { get; set; }

    public List<AdminRefundRequestItemResponse> Items { get; set; } = [];
}

public sealed class AdminRefundRequestItemResponse
{
    /// <summary>
    /// Which order line this is, so an approval can name an amount for it.
    /// </summary>
    /// <remarks>
    /// Left out while the only lever was the total: the screen showed the lines and had no way to
    /// act on any one of them, so their identity was of no use to it.
    /// </remarks>
    public Guid OrderItemId { get; set; }

    /// <summary>The extra this line of the request is for, when it is for one.</summary>
    public Guid? OrderItemOptionId { get; set; }

    /// <summary>
    /// Its name, so the approval screen can say "Smoky BBQ on Chicken Wings" rather than showing
    /// the dish twice with two different amounts and no way to tell them apart.
    /// </summary>
    public string? OptionNameSnapshot { get; set; }

    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public long AmountCents { get; set; }
}
