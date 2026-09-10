using DineFlow.Api.Contracts.Payments;

namespace DineFlow.Api.Contracts.Order;

public sealed class AdminOrderResponse
{
    /// <summary>
    /// A refund the customer has asked for and nobody has answered yet.
    /// </summary>
    /// <remarks>
    /// Refund requests were only visible on the payments screen, so a kitchen could be cooking an
    /// order the customer had already asked to be refunded and the order screen would show nothing
    /// at all. Carried here so the order can say so where the order is worked on.
    /// </remarks>
    public AdminOrderPendingRefundRequest? PendingRefundRequest { get; set; }

    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? RestaurantName { get; set; }

    /// <summary>
    /// Whether this restaurant takes money at the counter at all.
    /// </summary>
    /// <remarks>
    /// Carried on the order so the counter can tell, before it offers to move an unpaid online
    /// order onto the till, whether the shop would accept that — a button whose every press is
    /// refused is worse than one that is not there, because somebody takes the cash first and finds
    /// out afterwards.
    /// </remarks>
    public string? RestaurantPaymentPolicy { get; set; }
    public string? RestaurantLegalBusinessName { get; set; }
    public string? RestaurantAbn { get; set; }
    public bool RestaurantGstRegistered { get; set; }
    public bool RestaurantPricesIncludeGst { get; set; }
    public string? RestaurantAddress { get; set; }
    public string? RestaurantPhone { get; set; }
    public string? RestaurantRefundContactEmail { get; set; }
    public string? RestaurantCustomerSurchargeNotice { get; set; }

    public string Currency { get; set; } = string.Empty;

    public Guid? TableId { get; set; }

    public string? TableNumber { get; set; }

    public string? CustomerId { get; set; }

    public string? CustomerName { get; set; }

    public string? CustomerEmail { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public DateOnly? PickupDate { get; set; }

    public int? PickupNumber { get; set; }

    public string PickupCode { get; set; } = string.Empty;

    public Guid? TableSessionId { get; set; }

    public string OrderType { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string PaymentStatus { get; set; } = string.Empty;

    public string PaymentMethod { get; set; } = string.Empty;

    public bool CanProcess { get; set; }

    public List<string> AvailableActions { get; set; } = [];

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public int PaymentAttempts { get; set; }

    public AdminOrderPaymentResponse? LatestPayment { get; set; }

    public List<AdminOrderItemResponse> Items { get; set; } = [];
}

public sealed class AdminOrderItemResponse
{
    public Guid Id { get; set; }

    public Guid? MenuItemId { get; set; }

    public string ItemNameSnapshot { get; set; } = string.Empty;

    public int Quantity { get; set; }

    /// Menu price for one unit before any option adjustments, so a receipt can show the
    /// customer what the dish cost and what the extras added.
    public decimal BasePriceSnapshot { get; set; }

    /// The dish's allergen declaration as it read when the order was placed. Carried into the staff
    /// and kitchen views because they are what the people assembling the plate actually read.
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal TotalPrice { get; set; }

    public long RefundedAmountCents { get; set; }

    public long RefundableAmountCents { get; set; }

    public int RefundedQuantity { get; set; }

    public int RefundableQuantity { get; set; }

    public string? Note { get; set; }

    public List<AdminOrderItemOptionResponse> SelectedOptions { get; set; } = [];
}

public sealed class AdminOrderItemOptionResponse
{
    public Guid Id { get; set; }

    public Guid? MenuItemOptionId { get; set; }

    public string GroupNameSnapshot { get; set; } = string.Empty;

    public string OptionNameSnapshot { get; set; } = string.Empty;

    public decimal PriceAdjustmentSnapshot { get; set; }

    /// <summary>
    /// The modifier's allergen declaration as it read when the order was placed. Carried into the
    /// staff and kitchen views deliberately: the people assembling the plate are the ones who have
    /// to act on "the satay sauce contains peanut".
    /// </summary>
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public int Quantity { get; set; } = 1;
}

public sealed class AdminOrderPaymentResponse
{
    public Guid Id { get; set; }

    public string Provider { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public long AmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string? ProviderCheckoutSessionId { get; set; }

    public string? ProviderPaymentIntentId { get; set; }

    public string? ProviderChargeId { get; set; }

    public string? StripeAccountId { get; set; }

    public long PlatformFeeAmountCents { get; set; }

    public long? StripeFeeAmountCents { get; set; }

    public long? NetAmountCents { get; set; }

    public string? ProviderReceiptUrl { get; set; }

    public string? ReceiptEmail { get; set; }

    public string? DisputeId { get; set; }

    public string? DisputeStatus { get; set; }

    public long? DisputeAmountCents { get; set; }

    public DateTime? DisputeEvidenceDueBy { get; set; }

    public string? DisputeReason { get; set; }

    public DateTime? DisputedAt { get; set; }

    public DateTime? LastProviderEventCreatedAt { get; set; }

    public DateTime? LastSyncedAt { get; set; }

    public string? FailureReason { get; set; }

    public int RefundCount { get; set; }

    public long RefundedAmountCents { get; set; }

    public long RefundableAmountCents { get; set; }

    public bool HasPendingRefund { get; set; }


    public List<AdminPaymentRefundResponse> Refunds { get; set; } = [];

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }

    public DateTime? FailedAt { get; set; }
}

/// <summary>What staff need to see about an unanswered refund request, on the order itself.</summary>
public sealed class AdminOrderPendingRefundRequest
{
    public Guid Id { get; set; }

    public long RequestedAmountCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    /// <summary>The customer's own words. Shown verbatim: it is why they are asking.</summary>
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// True when granting it in full would call the order off, because nothing has been handed over
    /// yet. Lets the screen warn before the click rather than explain afterwards.
    /// </summary>
    public bool FullRefundWouldCancelOrder { get; set; }
}
