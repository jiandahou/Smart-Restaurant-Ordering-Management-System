using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;

namespace DineFlow.Api.Hubs;

[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public sealed class OrderHub(UserManager<ApplicationUser> userManager) : Hub
{
    public const string AllOrdersGroupName = "orders:all";

    public override async Task OnConnectedAsync()
    {
        var cancellationToken = Context.ConnectionAborted;

        if (Context.User?.IsInRole(ApplicationRoles.PlatformOwner) == true)
        {
            await Groups.AddToGroupAsync(
                Context.ConnectionId,
                AllOrdersGroupName,
                cancellationToken);
            await base.OnConnectedAsync();
            return;
        }

        var userId = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrWhiteSpace(userId))
        {
            var user = await userManager.FindByIdAsync(userId);
            if (user?.RestaurantId is Guid restaurantId)
            {
                await Groups.AddToGroupAsync(
                    Context.ConnectionId,
                    RestaurantGroupName(restaurantId),
                    cancellationToken);
                await base.OnConnectedAsync();
                return;
            }
        }

        Context.Abort();
    }

    public static string RestaurantGroupName(Guid restaurantId) => $"orders:restaurant:{restaurantId:D}";
}
