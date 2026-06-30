using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Reports;

public sealed class ReportLogListRequest : PagedRequest
{
    public Guid? RestaurantId { get; set; }

    public string? Action { get; set; }

    public string? EventType { get; set; }

    public string? EntityType { get; set; }

    public string? EntityId { get; set; }

    public Guid? OrderId { get; set; }

    public Guid? PaymentId { get; set; }

    public string? ActorUserId { get; set; }

    public DateTime? CreatedFrom { get; set; }

    public DateTime? CreatedTo { get; set; }
}
