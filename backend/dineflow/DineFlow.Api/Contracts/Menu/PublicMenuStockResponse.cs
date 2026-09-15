namespace DineFlow.Api.Contracts.Menu;

/// <summary>
/// What is left of a menu, and nothing else.
/// </summary>
/// <remarks>
/// <para>
/// Separate from the menu itself because of how often it has to be asked for. A menu open on a
/// phone shows stock that stopped being true the moment somebody else ordered, and the only way it
/// ever corrected itself was if the diner happened to reload. Re-fetching the whole menu on a timer
/// would fix that by sending every dish, description, allergen statement and option group over the
/// wire every few seconds, to every phone in the room, to learn that nothing had changed.
/// </para>
/// <para>
/// So this carries the two facts that actually move during service, keyed by id, and the browser
/// merges them into the menu it already has.
/// </para>
/// </remarks>
public sealed class PublicMenuStockResponse
{
    public Guid RestaurantId { get; init; }

    public List<PublicMenuItemStock> Items { get; init; } = [];

    public List<PublicMenuOptionStock> Options { get; init; } = [];
}

public sealed class PublicMenuItemStock
{
    public Guid Id { get; init; }

    public bool IsSoldOut { get; init; }

    /// <summary>
    /// What the customer may be told is left, decided by the same rule the full menu uses.
    /// </summary>
    public int? RemainingStock { get; set; }
}

public sealed class PublicMenuOptionStock
{
    public Guid Id { get; init; }

    public int? RemainingStock { get; init; }
}
