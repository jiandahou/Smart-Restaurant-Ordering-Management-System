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
}
