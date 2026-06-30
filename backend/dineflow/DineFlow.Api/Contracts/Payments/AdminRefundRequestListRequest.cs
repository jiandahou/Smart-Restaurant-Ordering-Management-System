using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundRequestListRequest : PagedRequest
{
    public string? Status { get; set; }

    public Guid? RestaurantId { get; set; }
}
