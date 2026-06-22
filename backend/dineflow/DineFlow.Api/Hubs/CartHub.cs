using DineFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace DineFlow.Api.Hubs;

[AllowAnonymous]
public sealed class CartHub(
    CartAccessService cartAccessService,
    CartRealtimeNotifier cartRealtimeNotifier) : Hub
{
    public async Task JoinCart(
        Guid cartId,
        string participantToken,
        CancellationToken cancellationToken)
    {
        var access = await cartAccessService.AuthorizeAsync(
            cartId,
            participantToken,
            cancellationToken);

        if (access.Failure != CartAccessFailure.None)
        {
            if (access.Failure == CartAccessFailure.Expired)
            {
                await cartRealtimeNotifier.CartExpiredAsync(cartId, cancellationToken);
            }

            throw new HubException(GetAccessError(access.Failure));
        }

        await cartAccessService.TouchParticipantAsync(access.Participant!, cancellationToken);

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            GroupName(cartId),
            cancellationToken);

        var snapshot = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);
        await Clients.Caller.SendAsync(
            CartRealtimeEvents.CartUpdated,
            new CartRealtimeUpdate("connected", snapshot),
            cancellationToken);
    }

    public Task LeaveCart(Guid cartId, CancellationToken cancellationToken)
    {
        return Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            GroupName(cartId),
            cancellationToken);
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
