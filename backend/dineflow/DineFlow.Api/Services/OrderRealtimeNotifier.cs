using DineFlow.Api.Hubs;
using DineFlow.Infrastructure.Orders;
using Microsoft.AspNetCore.SignalR;

namespace DineFlow.Api.Services;

public sealed class OrderRealtimeNotifier(
    IHubContext<OrderHub> hubContext,
    ILogger<OrderRealtimeNotifier> logger)
{
    public Task OrderCreatedAsync(Order order, CancellationToken cancellationToken) =>
        SendAsync(OrderRealtimeEvents.OrderCreated, "created", order, cancellationToken);

    public Task OrderUpdatedAsync(Order order, CancellationToken cancellationToken) =>
        SendAsync(OrderRealtimeEvents.OrderUpdated, "updated", order, cancellationToken);

    public Task OrderPaymentUpdatedAsync(Order order, CancellationToken cancellationToken) =>
        SendAsync(OrderRealtimeEvents.OrderPaymentUpdated, "payment-updated", order, cancellationToken);

    public Task OrderDeletedAsync(Order order, CancellationToken cancellationToken) =>
        SendAsync(OrderRealtimeEvents.OrderDeleted, "deleted", order, cancellationToken);

    private async Task SendAsync(
        string eventName,
        string reason,
        Order order,
        CancellationToken cancellationToken)
    {
        try
        {
            var update = new OrderRealtimeUpdate(
                reason,
                order.Id,
                order.RestaurantId,
                order.OrderNumber,
                order.Status.ToString(),
                order.PaymentStatus.ToString(),
                order.PaymentMethod.ToString(),
                DateTime.UtcNow);

            var groups = order.RestaurantId.HasValue
                ? new[] { OrderHub.AllOrdersGroupName, OrderHub.RestaurantGroupName(order.RestaurantId.Value) }
                : new[] { OrderHub.AllOrdersGroupName };

            await hubContext.Clients
                .Groups(groups)
                .SendAsync(eventName, update, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex,
                "Failed to publish realtime order event {EventName} for order {OrderId}.",
                eventName,
                order.Id);
        }
    }
}
