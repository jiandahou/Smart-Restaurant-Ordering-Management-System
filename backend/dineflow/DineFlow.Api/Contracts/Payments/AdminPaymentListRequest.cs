using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminPaymentListRequest : PagedRequest
{
    public string? Status { get; set; }

    public string? OrderStatus { get; set; }

    public string? OrderType { get; set; }

    public Guid? RestaurantId { get; set; }
}
