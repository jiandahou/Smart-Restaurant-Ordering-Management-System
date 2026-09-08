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
    /// What this option did to the line's price when the order was placed, or null when that can no
    /// longer be established.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The price adjustment was snapshotted from the start; what it meant was not. An
    /// <see cref="Menu.OptionAdjustmentType.Add"/> of 3.00 raises the line by three, a
    /// <see cref="Menu.OptionAdjustmentType.Remove"/> lowers it, and a
    /// <see cref="Menu.OptionAdjustmentType.Replace"/> discards the base price and every option
    /// before it. The same stored 3.00 therefore describes three different prices, and which one it
    /// was could only be recovered by reading the live menu — which is not a record of anything:
    /// <see cref="MenuItemOptionId"/> is nullable because options get archived, and a restaurant may
    /// have changed the type since. A past order's price became unexplainable the moment either
    /// happened.
    /// </para>
    /// <para>
    /// Nullable rather than an <c>Unknown</c> member on the enum: the enum says what a menu option
    /// does, and rows written before this column existed are a fact about our records, not about
    /// any option. Null means the type is unknown, and everything that needs it — pricing a
    /// modifier in order to refund it, above all — declines rather than guesses.
    /// </para>
    /// </remarks>
    public Menu.OptionAdjustmentType? AdjustmentTypeSnapshot { get; set; }

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
