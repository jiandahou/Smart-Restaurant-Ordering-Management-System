namespace DineFlow.Api.Contracts.Order;

public class OrderResponse
{
    public Guid Id { get; set; }

    public Guid? RestaurantId { get; set; }

    // Supplier details the customer's own receipt has to carry: an Australian proof of
    // transaction needs the supplier's name and ABN, and a tax invoice needs the GST position.
    public string? RestaurantName { get; set; }

    public string? RestaurantLegalBusinessName { get; set; }

    public string? RestaurantAbn { get; set; }

    public bool RestaurantGstRegistered { get; set; }

    /// <summary>Whether prices already include GST, for the receipt wording.</summary>
    public bool RestaurantPricesIncludeGst { get; set; }

    /// <summary>
    /// Whether the restaurant allows settling at the counter, and whether it can take a card right
    /// now. Sent so a page reached from an order alone — with no cart behind it — can still offer
    /// the payment choices that actually exist.
    /// </summary>
    public string RestaurantPaymentPolicy { get; set; } = string.Empty;

    public bool RestaurantOnlinePaymentsEnabled { get; set; }

    public string? RestaurantAddress { get; set; }

    public string? RestaurantPhone { get; set; }

    public string? RestaurantRefundContactEmail { get; set; }

    public string? RestaurantCustomerSurchargeNotice { get; set; }

    public Guid? TableId { get; set; }

    public string? TableNumber { get; set; }

    public string? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public DateOnly? PickupDate { get; set; }

    public int? PickupNumber { get; set; }

    public string PickupCode { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public int OrderType { get; set; }

    public int Status { get; set; }

    public string PaymentStatus { get; set; } = string.Empty;

    public string PaymentMethod { get; set; } = string.Empty;

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    /// When the payment settled. The clock the acceptance wait is measured against.
    public DateTime? PaidAt { get; set; }

    /// True once the customer may cancel this paid order themselves and be refunded.
    public bool CanCancelForRefund { get; set; }

    /// UTC instant that right becomes available, so the page can count down to it.
    public DateTime? CancellableForRefundAt { get; set; }

    /// <summary>
    /// UTC instant an unpaid order releases the stock and pickup number it is holding, or null when
    /// it holds nothing — already paid, already settled, or a payment attempt is in flight.
    /// </summary>
    public DateTime? UnpaidExpiresAt { get; set; }

    /// <summary>
    /// Why this order was rejected or cancelled, as whoever ended it recorded at the time.
    /// </summary>
    /// <remarks>
    /// Staff already choose a reason when they turn an order away — "Item is unavailable",
    /// "Duplicate order" — and it was written to the order's history and stopped there. The customer
    /// saw their order become Rejected with nothing beside it, which is the moment they most need
    /// telling: whether to reorder without that dish, or not to bother.
    /// </remarks>
    public OrderClosureReason? ClosureReason { get; set; }

    public CustomerRefundRequestResponse? LatestRefundRequest { get; set; }

    public OrderRefundBalance RefundBalance { get; set; } = new();

    public List<OrderItemResponse> OrderItems { get; set; } = new();
}

/// <summary>How an order came to be closed, in terms a customer can act on.</summary>
public sealed class OrderClosureReason
{
    /// <summary>"Reject" or "Cancel" — who turned it away matters as much as why.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>The restaurant's own wording, verbatim. Null when none was recorded.</summary>
    public string? Reason { get; set; }

    /// <summary>True when the customer ended the order themselves.</summary>
    public bool EndedByCustomer { get; set; }

    public DateTime At { get; set; }
}

public class OrderRefundBalance
{
    /// Total already refunded against this order's payment (succeeded refunds only).
    public long AlreadyRefundedAmountCents { get; set; }

    /// What is still available to refund. Zero when there is no refundable online payment.
    public long RefundableAmountCents { get; set; }

    /// Refunded money that could NOT be tied to specific items — direct refunds and adjusted
    /// multi-item approvals. Surfaced separately so we never imply a wrong item was refunded.
    public long UnattributedRefundedAmountCents { get; set; }
}

public class OrderItemResponse
{
    public Guid Id { get; set; }

    public Guid OrderId { get; set; }

    public Guid? MenuItemId { get; set; }

    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public decimal BasePriceSnapshot { get; set; }

    /// <summary>The dish's allergen declaration as it read when the order was placed.</summary>
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public string ItemNameSnapshot { get; set; } = string.Empty;

    /// Current menu image for this item, when the menu item still exists.
    /// Not snapshotted — purely presentational, so it may be null for deleted menu items.
    public string? ImageUrl { get; set; }

    public int Quantity { get; set; }

    /// Units of this line already refunded, counted only from refunds we can attribute exactly
    /// to this item. Partial unit refunds are reflected in the amount fields below.
    public int RefundedQuantity { get; set; }

    /// Money already refunded and unambiguously attributed to this order line.
    public long RefundedAmountCents { get; set; }

    /// Money that can still be requested against this line before applying the order-wide cap.
    public long RefundableAmountCents { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal TotalPrice => Quantity * UnitPrice;

    public string? ItemInstructions { get; set; }

    public string? Note { get; set; }

    public string? AllergyInfo { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public List<OrderItemOptionResponse> SelectedOptions { get; set; } = new();
}

public class OrderItemOptionResponse
{
    public Guid Id { get; set; }

    public Guid? MenuItemOptionId { get; set; }

    public string GroupNameSnapshot { get; set; } = string.Empty;

    public string OptionNameSnapshot { get; set; } = string.Empty;

    public decimal PriceAdjustmentSnapshot { get; set; }

    /// <summary>The modifier's allergen declaration as it read when the order was placed.</summary>
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public int Quantity { get; set; } = 1;
}

public sealed class GuestOrderLookupRequest
{
    /// Legacy shape, kept so orders saved before guest tokens existed can still be looked up.
    public List<Guid> OrderIds { get; set; } = new();

    /// Preferred shape: each order paired with the token issued when it was placed.
    public List<GuestOrderLookupEntry> Orders { get; set; } = new();
}

public sealed class GuestOrderLookupEntry
{
    public Guid OrderId { get; set; }

    public string? GuestAccessToken { get; set; }
}
