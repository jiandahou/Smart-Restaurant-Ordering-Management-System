using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Users;

public sealed class UserListRequest : PagedRequest
{
    public string? Role { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? Scope { get; set; }
}
