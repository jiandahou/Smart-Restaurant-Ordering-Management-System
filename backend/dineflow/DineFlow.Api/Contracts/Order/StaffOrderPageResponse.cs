namespace DineFlow.Api.Contracts.Order;

/// <summary>
/// A page of the staff order screen, together with how much work each queue actually holds.
/// </summary>
/// <remarks>
/// The counts are worked out over everything the filters match, not over the rows on this page, so
/// changing the sort or turning to page two does not change what the tabs say.
/// </remarks>
public sealed class StaffOrderPageResponse
{
    public required IReadOnlyList<AdminOrderResponse> Items { get; init; }

    public required int Page { get; init; }

    public required int PageSize { get; init; }

    /// <summary>How many orders are in the queue being shown, across every page of it.</summary>
    public required int TotalItems { get; init; }

    /// <summary>Every queue and its size, so the tabs can be read without fetching each one.</summary>
    public required IReadOnlyDictionary<string, int> QueueCounts { get; init; }

    public int TotalPages => TotalItems == 0 ? 0 : (int)Math.Ceiling(TotalItems / (double)PageSize);

    public bool HasPreviousPage => Page > 1;

    public bool HasNextPage => Page < TotalPages;
}
