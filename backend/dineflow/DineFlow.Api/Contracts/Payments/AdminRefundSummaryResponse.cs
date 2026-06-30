namespace DineFlow.Api.Contracts.Payments;

public sealed class AdminRefundSummaryResponse
{
    public int Total { get; set; }

    public int Pending { get; set; }

    public int Succeeded { get; set; }

    public int Failed { get; set; }

    public List<AdminRefundCurrencySummaryResponse> AmountsByCurrency { get; set; } = [];
}

public sealed class AdminRefundCurrencySummaryResponse
{
    public string Currency { get; set; } = string.Empty;

    public long PendingAmountCents { get; set; }

    public long SucceededAmountCents { get; set; }

    public long FailedAmountCents { get; set; }
}
