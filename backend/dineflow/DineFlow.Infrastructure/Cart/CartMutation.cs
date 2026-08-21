namespace DineFlow.Infrastructure.Carts;

/// <summary>
/// One cart mutation that has already been applied, remembered by the key the caller sent with it.
///
/// <para>
/// Adding an item is the one cart operation that is not naturally repeatable: it does
/// <c>Quantity += request.Quantity</c>, so sending it twice adds twice. A phone that loses signal
/// after the server committed but before the response arrived has no way to tell that apart from a
/// request that never landed, and the only safe thing it can do is retry — which quietly doubled
/// the order.
/// </para>
///
/// <para>
/// The row is claimed in the same transaction as the mutation it describes, so the key exists if
/// and only if the change did. A crash between the two leaves neither.
/// </para>
/// </summary>
public class CartMutation
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CartId { get; set; }

    /// <summary>
    /// The caller's key, unique per cart. Scoped to the cart rather than globally so one customer
    /// cannot deny another the use of a key, and so the rows die with the cart.
    /// </summary>
    public string IdempotencyKey { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Cart? Cart { get; set; }
}
