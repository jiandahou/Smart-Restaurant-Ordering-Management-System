using DineFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace DineFlow.Api.Hubs;

[AllowAnonymous]
public sealed class CartHub(
    CartAccessService cartAccessService,
    CartRealtimeNotifier cartRealtimeNotifier) : Hub
{
    public async Task JoinCart(Guid cartId, string participantToken)
    {
        var ct = Context.ConnectionAborted;

        var access = await cartAccessService.AuthorizeAsync(
            cartId,
            participantToken,
            ct);

        if (access.Failure != CartAccessFailure.None)
        {
            if (access.Failure == CartAccessFailure.Expired)
            {
                await cartRealtimeNotifier.CartExpiredAsync(cartId, ct);
            }

            throw new HubException(GetAccessError(access.Failure));
        }

        await cartAccessService.TouchParticipantAsync(access.Participant!, ct);

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            GroupName(cartId),
            ct);

        var snapshot = await cartAccessService.LoadSnapshotAsync(cartId, ct);
        await Clients.Caller.SendAsync(
            CartRealtimeEvents.CartUpdated,
            new CartRealtimeUpdate("connected", snapshot),
            ct);
    }

    public Task LeaveCart(Guid cartId)
    {
        return Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            GroupName(cartId),
            Context.ConnectionAborted);
    }

    public static string GroupName(Guid cartId) => $"cart:{cartId:D}";

    private static string GetAccessError(CartAccessFailure failure)
    {
        return failure switch
        {
            CartAccessFailure.NotFound => "Cart not found.",
            CartAccessFailure.Expired => "Cart has expired.",
            _ => "Cart participant token is invalid."
        };
    }
}
