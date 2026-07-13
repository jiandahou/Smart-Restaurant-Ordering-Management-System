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

    public string? CustomerId { get; set; }

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

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

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
