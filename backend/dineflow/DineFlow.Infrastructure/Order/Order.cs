using System;
using System.Collections.Generic;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Restaurant;

namespace DineFlow.Infrastructure.Orders;

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid? RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    /// <summary>
    /// The cart this order was placed from, when it came from one.
    ///
    /// <para>
    /// Carries a unique index so the database itself can only ever hold one order per cart. Two
    /// concurrent checkouts used to produce two orders and two order numbers from a single cart,
    /// with the cart pointing at whichever committed last and the other left in the kitchen queue
    /// belonging to nobody. Application-level locking is what normally prevents that; this is what
    /// makes it impossible.
    /// </para>
    ///
    /// <para>Null for orders that never had a cart — counter and admin-created orders.</para>
    /// </summary>
    public Guid? CartId { get; set; }

    public string? CustomerId { get; set; }

    /// SHA-256 of the guest access token. Guest orders have no account behind them, so this is the
    /// only credential proving the caller placed the order — the order id is a plain identifier
    /// that appears in logs, printed tickets and support tickets, and must never act as a secret.
    /// Null on orders that predate this, and on orders owned by a signed-in customer.
    public string? GuestAccessTokenHash { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public DateOnly? PickupDate { get; set; }

    public int? PickupNumber { get; set; }

    public Guid? TableSessionId { get; set; }

    public OrderType OrderType { get; set; } = OrderType.DineIn;

    public OrderStatus Status { get; set; } = OrderStatus.Pending;

    public PaymentStatus PaymentStatus { get; set; } = PaymentStatus.Unpaid;

    public PaymentMethod PaymentMethod { get; set; } = PaymentMethod.Online;

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public string? AcceptedCustomerTermsVersion { get; set; }

    public string? AcknowledgedPrivacyPolicyVersion { get; set; }

    public string? AcknowledgedAllergenNoticeVersion { get; set; }

    public DateTime? LegalAcceptedAt { get; set; }

    public string? LegalAcceptanceIpAddress { get; set; }

    public string? LegalAcceptanceUserAgent { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    /// <summary>
    /// When this order gave back the stock it reserved at checkout, or null while it still holds it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Whether an order is holding portions used to be inferred from its status, and the inference
    /// was wrong: two of the three paths that closed an order released its stock and the third —
    /// staff rejecting at the counter — did not, so Cancelled meant "released" for some rows and
    /// "still held" for others with nothing to tell them apart. Reopening one of the second kind
    /// would have reserved a second time for portions never given back.
    /// </para>
    /// <para>
    /// So the row says it. Release and re-reservation both read and write this field, which makes
    /// each of them idempotent and makes the leaked orders findable rather than merely suspected.
    /// </para>
    /// </remarks>
    public DateTime? StockReleasedAt { get; set; }

    public int TicketRevision { get; set; } = 1;

    public ICollection<OrderItem> OrderItems { get; set; } = [];

    public ICollection<OrderStatusHistory> StatusHistory { get; set; } = [];

    public ICollection<Payment> Payments { get; set; } = [];

    public ICollection<PaymentRefundRequest> RefundRequests { get; set; } = [];

    public ApplicationUser? Customer { get; set; }

    public RestaurantTable? Table { get; set; }

    public TableSession? TableSession { get; set; }

    public Restaurant.Restaurant? Restaurant { get; set; }
}

public enum OrderType
{
    DineIn,
    Takeaway,
    Scheduled
}

public enum OrderStatus
{
    Pending,
    Accepted,
    Preparing,
    Ready,
    Completed,
    Cancelled,
    Rejected
}
