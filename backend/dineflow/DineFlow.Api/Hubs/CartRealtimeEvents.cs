using DineFlow.Api.Contracts.Cart;

namespace DineFlow.Api.Hubs;

public static class CartRealtimeEvents
{
    public const string CartUpdated = "CartUpdated";
    public const string CartExpired = "CartExpired";
    public const string CartSubmitted = "CartSubmitted";
}

public sealed record CartRealtimeUpdate(string Reason, CartResponse? Cart);
