using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Order;

public sealed class AdminOrderListRequest : PagedRequest
{
    public string? Status { get; set; }

    public string? PaymentStatus { get; set; }

    public string? OrderType { get; set; }

    public Guid? RestaurantId { get; set; }

    public bool? PayableOnly { get; set; }
}
