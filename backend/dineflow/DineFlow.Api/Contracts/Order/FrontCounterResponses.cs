using System.ComponentModel.DataAnnotations;

namespace DineFlow.Api.Contracts.Order;

public sealed class FrontCounterListRequest
{
    public Guid? RestaurantId { get; set; }

    public string? Search { get; set; }

    [Range(25, 500)]
    public int PageSize { get; set; } = 100;
}

public sealed class FrontCounterTakeawayResponse
{
    public DateTime GeneratedAt { get; set; }

    /// <summary>
    /// The restaurant's current business day, used by the UI to label pickup dates as
    /// today / yesterday. Pickup numbers restart at 1 on this boundary.
    /// </summary>
    public DateOnly BusinessDate { get; set; }

    public int TotalOrders { get; set; }

    public List<AdminOrderResponse> Orders { get; set; } = [];
}

public sealed class FrontCounterTableSessionsResponse
{
    public DateTime GeneratedAt { get; set; }

    public List<FrontCounterTableSessionSummaryResponse> Sessions { get; set; } = [];
}

public sealed class FrontCounterTablesResponse
{
    public DateTime GeneratedAt { get; set; }

    public List<FrontCounterTableSummaryResponse> Tables { get; set; } = [];
}

public class FrontCounterTableSummaryResponse
{
    public Guid RestaurantId { get; set; }

    public string RestaurantName { get; set; } = string.Empty;

    public Guid TableId { get; set; }

    public string TableNumber { get; set; } = string.Empty;

    public int Capacity { get; set; }

    public bool IsActive { get; set; }

    public Guid? ActiveSessionId { get; set; }

    public DateTime? OpenedAt { get; set; }

    public string Currency { get; set; } = string.Empty;

    public int ActiveOrderCount { get; set; }

    public int HistoryOrderCount { get; set; }

    public int ItemCount { get; set; }

    public decimal TotalAmount { get; set; }

    public decimal AmountDue { get; set; }

    public string LatestOrderStatus { get; set; } = string.Empty;

    public List<FrontCounterMergedItemResponse> MergedItems { get; set; } = [];

    public List<AdminOrderResponse> ActiveOrders { get; set; } = [];
}

public sealed class FrontCounterTableDetailResponse : FrontCounterTableSummaryResponse
{
    public FrontCounterTableSessionDetailResponse? ActiveSession { get; set; }

    public List<AdminOrderResponse> HistoryOrders { get; set; } = [];
}

public class FrontCounterTableSessionSummaryResponse
{
    public Guid Id { get; set; }

    public Guid RestaurantId { get; set; }

    public string RestaurantName { get; set; } = string.Empty;

    public Guid TableId { get; set; }

    public string TableNumber { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public DateTime OpenedAt { get; set; }

    public DateTime? ClosedAt { get; set; }

    public string Currency { get; set; } = string.Empty;

    public int ActiveOrderCount { get; set; }

    public int ItemCount { get; set; }

    public decimal TotalAmount { get; set; }

    public decimal AmountDue { get; set; }

    public string LatestOrderStatus { get; set; } = string.Empty;
}

public sealed class FrontCounterTableSessionDetailResponse : FrontCounterTableSessionSummaryResponse
{
    public List<FrontCounterMergedItemResponse> MergedItems { get; set; } = [];

    public List<AdminOrderResponse> Orders { get; set; } = [];
}

public sealed class FrontCounterMergedItemResponse
{
    public string ItemName { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public decimal UnitPrice { get; set; }

    public decimal TotalPrice { get; set; }

    public string? Note { get; set; }

    public List<AdminOrderItemOptionResponse> SelectedOptions { get; set; } = [];

    public List<Guid> OrderItemIds { get; set; } = [];
}

public sealed class FrontCounterSettleOrderResponse
{
    public AdminOrderResponse Order { get; set; } = new();
}

public class CounterReversalRequest
{
    /// Mandatory. The system cannot verify an offline reversal, so the reason is the control.
    public string? Reason { get; set; }
}

public sealed class CounterOfflineRefundRequest : CounterReversalRequest
{
    /// Null refunds the whole remaining balance.
    public long? AmountCents { get; set; }
}

public sealed class FrontCounterRecordPaymentRequest
{
    public string Tender { get; set; } = "Card";

    public decimal? AmountReceived { get; set; }
}

public sealed class FrontCounterRecordPaymentResponse
{
    public AdminOrderResponse Order { get; set; } = new();

    public decimal AmountReceived { get; set; }

    public decimal ChangeDue { get; set; }
}

public sealed class FrontCounterSettleTableSessionRequest
{
    public string Tender { get; set; } = "Card";

    public decimal? AmountReceived { get; set; }
}

public sealed class FrontCounterSettleTableSessionResponse
{
    public FrontCounterTableSessionDetailResponse TableSession { get; set; } = new();

    public decimal AmountReceived { get; set; }

    public decimal ChangeDue { get; set; }
}
