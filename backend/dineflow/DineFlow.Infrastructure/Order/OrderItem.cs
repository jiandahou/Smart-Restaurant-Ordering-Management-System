namespace DineFlow.Infrastructure.Orders;

public class OrderItem
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid OrderId { get; set; }

    public Guid? MenuItemId { get; set; }

    // Immutable snapshots — preserved even if menu changes later
    public string MenuItemNameSnapshot { get; set; } = string.Empty;

    public decimal BasePriceSnapshot { get; set; }

    /// <summary>
    /// The dish's allergen declaration exactly as it read when this order was placed.
    ///
    /// <para>
    /// The order recorded which version of the allergen *notice* the customer acknowledged, but not
    /// the declarations themselves — those were only ever read live from the menu. Once a
    /// restaurant corrected a dish, every past order silently began describing the corrected
    /// version, so the record of what a customer was actually shown, and accepted, was gone. That
    /// record is the one that matters when someone reacts to a meal and asks what they were told.
    /// </para>
    /// </summary>
    public string? AllergensSnapshot { get; set; }

    public string? MayContainAllergensSnapshot { get; set; }

    public string? CrossContactStatementSnapshot { get; set; }

    public int Quantity { get; set; } = 1;

    // Calculated server-side: BasePriceSnapshot + sum of option price adjustments
    public decimal UnitPrice { get; set; }

    public decimal TotalPrice => Quantity * UnitPrice;

    public string? ItemInstructions { get; set; }

    public string? AllergyInfo { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public Order? Order { get; set; }

    public ICollection<OrderItemOption> SelectedOptions { get; set; } = [];
}
