namespace DineFlow.Api.Contracts.Order;

/// <summary>One paid total, in the currency it was actually taken in.</summary>
public sealed class AdminOrderRevenueResponse
{
    public string Currency { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public int Orders { get; set; }
}

public sealed class AdminOrderSummaryResponse
{
    public int Total { get; set; }

    public int ActiveKitchen { get; set; }

    public int Paid { get; set; }

    public int PendingPayment { get; set; }

    public int FailedPayment { get; set; }

    public int Payable { get; set; }

    /// <summary>
    /// Paid revenue, one entry per currency.
    ///
    /// <para>
    /// This used to be a single decimal summed across every restaurant on the platform, which the
    /// dashboard then formatted with whichever currency the first active restaurant happened to
    /// use: AUD 325.50 + INR 616.00 + NPR 1113.00 was rendered as "A$2054.50". There is no exchange
    /// rate anywhere in this system, so there is no total to report — only totals.
    /// </para>
    /// </summary>
    public IReadOnlyList<AdminOrderRevenueResponse> Revenue { get; set; } = [];
}
