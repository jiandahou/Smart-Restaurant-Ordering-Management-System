namespace DineFlow.Infrastructure.Reporting;

public class OrderEventLog
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid? RestaurantId { get; set; }

    public Guid OrderId { get; set; }

    public string OrderNumber { get; set; } = string.Empty;

    public string? ActorUserId { get; set; }

    public string? ActorDisplayName { get; set; }

    public string? ActorRoles { get; set; }

    public string EventType { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public string? DataJson { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
