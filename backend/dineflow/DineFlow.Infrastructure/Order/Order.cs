using System;
using System.Collections.Generic;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Infrastructure.Orders;

public class Order
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public Guid? TableId { get; set; }

    public Guid? CustomerId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public OrderType OrderType { get; set; } = OrderType.DineIn;

    public OrderStatus Status { get; set; } = OrderStatus.Pending;

    public PaymentStatus PaymentStatus { get; set; } = PaymentStatus.Pending;

    public decimal TotalAmount { get; set; }

    public string? CustomerNote { get; set; }

    public DateTime? ScheduledTime { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public ICollection<OrderItem> OrderItems { get; set; } = new List<OrderItem>();

    public ICollection<Payment> Payments { get; set; } = new List<Payment>();
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
