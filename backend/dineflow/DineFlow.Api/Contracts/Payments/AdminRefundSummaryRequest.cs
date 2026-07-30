namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundSummaryRequest
{
    public Guid? RestaurantId { get; set; }

    public string? Search { get; set; }

    public string? Status { get; set; }

    public DateTime? CreatedFromUtc { get; set; }

    public DateTime? CreatedToUtc { get; set; }
}
