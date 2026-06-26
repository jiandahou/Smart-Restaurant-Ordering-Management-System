namespace DineFlow.Api.Hubs;

public static class OrderRealtimeEvents
{
    public const string OrderCreated = "OrderCreated";
    public const string OrderUpdated = "OrderUpdated";
    public const string OrderPaymentUpdated = "OrderPaymentUpdated";
    public const string OrderDeleted = "OrderDeleted";
}

public sealed record OrderRealtimeUpdate(
    string Reason,
    Guid OrderId,
    Guid? RestaurantId,
    string OrderNumber,
    string Status,
    string PaymentStatus,
    string PaymentMethod,
    DateTime OccurredAt);
