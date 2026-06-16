using System;

namespace DineFlow.Infrastructure.Restaurant;

public class RestaurantTable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid RestaurantId { get; set; }

    public string TableNumber { get; set; } = string.Empty;

    public string QrToken { get; set; } = string.Empty;

    public int Capacity { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }
}
