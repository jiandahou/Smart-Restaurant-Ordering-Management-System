using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundListRequest : PagedRequest
{
    public string? Status { get; set; }

    public Guid? RestaurantId { get; set; }
}
