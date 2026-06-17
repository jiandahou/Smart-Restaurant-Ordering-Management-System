using DineFlow.Api.Contracts.Cart;
using DineFlow.Api.Contracts.Order;

namespace DineFlow.Api.Hubs;

public static class CartRealtimeEvents
{
    public const string CartUpdated = "CartUpdated";
    public const string CartExpired = "CartExpired";
    public const string CartSubmitted = "CartSubmitted";
}

public sealed record CartRealtimeUpdate(string Reason, CartResponse? Cart);

public sealed record CartSubmittedUpdate(CartResponse Cart, OrderResponse Order);
