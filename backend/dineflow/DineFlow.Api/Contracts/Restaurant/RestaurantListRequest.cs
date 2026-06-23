using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Restaurant;

public sealed class RestaurantListRequest : PagedRequest
{
    public bool? IsActive { get; set; }

    public string? Currency { get; set; }
}
