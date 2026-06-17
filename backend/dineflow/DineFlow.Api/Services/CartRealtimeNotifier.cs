using DineFlow.Api.Contracts.Cart;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace DineFlow.Api.Services;

public sealed class CartRealtimeNotifier(IHubContext<CartHub> hubContext)
{
    public Task CartUpdatedAsync(
        Guid cartId,
        string reason,
        CartResponse snapshot,
        CancellationToken cancellationToken)
    {
        return hubContext.Clients
            .Group(CartHub.GroupName(cartId))
            .SendAsync(
                CartRealtimeEvents.CartUpdated,
                new CartRealtimeUpdate(reason, snapshot),
                cancellationToken);
    }

    public Task CartExpiredAsync(Guid cartId, CancellationToken cancellationToken)
    {
        return hubContext.Clients
            .Group(CartHub.GroupName(cartId))
            .SendAsync(CartRealtimeEvents.CartExpired, cancellationToken);
    }

    public Task CartSubmittedAsync(
        Guid cartId,
        CartResponse cart,
        OrderResponse order,
        CancellationToken cancellationToken)
    {
        return hubContext.Clients
            .Group(CartHub.GroupName(cartId))
            .SendAsync(
                CartRealtimeEvents.CartSubmitted,
                new CartSubmittedUpdate(cart, order),
                cancellationToken);
    }
}
