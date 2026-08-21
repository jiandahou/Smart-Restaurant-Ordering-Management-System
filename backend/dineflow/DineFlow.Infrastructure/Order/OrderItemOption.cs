namespace DineFlow.Infrastructure.Orders;

public class OrderItemOption
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderItemId { get; set; }

    // Nullable — original option may be archived/deleted
    public Guid? MenuItemOptionId { get; set; }

    // Immutable snapshots
    public string GroupNameSnapshot { get; set; } = string.Empty;

    public string OptionNameSnapshot { get; set; } = string.Empty;

    public decimal PriceAdjustmentSnapshot { get; set; }

    /// <summary>
    /// The modifier's own allergen declaration as it read when the order was placed.
    ///
    /// <para>
    /// Snapshotted for the same reason the name and the price are: a receipt has to say what the
    /// customer was told, not what the menu says today. If a restaurant later corrects an option's
    /// declaration, a past order must still show the wording the customer read and accepted.
    /// </para>
    /// </summary>
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public int Quantity { get; set; } = 1;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public OrderItem? OrderItem { get; set; }
}
