namespace DineFlow.Api.Contracts.Menu;

/// <summary>
/// A menu item pinned to the dashboard watch list, trimmed to what the widget needs to show it and
/// flip it.
/// </summary>
public class WatchedMenuItemResponse
{
    public Guid Id { get; set; }

    public Guid RestaurantId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string CategoryName { get; set; } = string.Empty;

    public decimal Price { get; set; }

    public bool IsAvailable { get; set; }

    public bool IsSoldOut { get; set; }

    /// <summary>Remaining portions, or null when the item is untracked / unlimited.</summary>
    public int? StockQuantity { get; set; }
}

public class UpdateMenuItemWatchRequest
{
    public bool IsWatched { get; set; }
}

public class UpdateMenuItemStockRequest
{
    /// <summary>Remaining portions. Null turns stock tracking off, making the item unlimited.</summary>
    public int? StockQuantity { get; set; }

    /// <summary>
    /// Change the count by this much instead of setting it, applied by the database rather than
    /// computed from a value the client read earlier.
    ///
    /// <para>
    /// Two people pressing "one less" at the same moment both read the same number, both wrote it
    /// back, and one sale disappeared. A delta cannot lose that way: the row is what is being
    /// added to, not a number the client remembered.
    /// </para>
    /// </summary>
    public int? AdjustBy { get; set; }
}
