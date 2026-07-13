using System;
using DineFlow.Infrastructure.Orders;

namespace DineFlow.Infrastructure.Restaurant;

public class TableSession
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public Guid TableId { get; set; }

    public TableSessionStatus Status { get; set; } = TableSessionStatus.Open;

    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;

    public DateTime? ClosedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public Restaurant? Restaurant { get; set; }

    public RestaurantTable? Table { get; set; }

    public ICollection<Order> Orders { get; set; } = [];
}

public enum TableSessionStatus
{
    Open,
    Closed
}
