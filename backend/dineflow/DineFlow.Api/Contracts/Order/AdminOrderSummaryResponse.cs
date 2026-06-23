namespace DineFlow.Api.Contracts.Order;

public sealed class AdminOrderSummaryResponse
{
    public int Total { get; set; }

    public int ActiveKitchen { get; set; }

    public int Paid { get; set; }

    public int PendingPayment { get; set; }

    public int FailedPayment { get; set; }

    public int Payable { get; set; }

    public decimal Revenue { get; set; }
}
