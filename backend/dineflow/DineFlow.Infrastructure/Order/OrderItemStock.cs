namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// How many units of each tracked dish an order consumes.
/// </summary>
/// <remarks>
/// <para>
/// The companion to <see cref="OrderOptionStock"/>, and here for the same reason: the reservation,
/// the release and the sweeper all have to count the same way, and the rule lived inside a
/// controller where only that controller could reach it. A service that needed it had to reach back
/// into the API layer to borrow it.
/// </para>
/// </remarks>
public static class OrderItemStock
{
    public static Dictionary<Guid, int> RequestedQuantities(IEnumerable<OrderItem> orderItems)
    {
        var quantities = new Dictionary<Guid, int>();

        foreach (var orderItem in orderItems)
        {
            // A snapshot of a dish that has since been deleted has nothing left to reserve against.
            if (orderItem.MenuItemId is not { } menuItemId)
            {
                continue;
            }

            quantities[menuItemId] = quantities.GetValueOrDefault(menuItemId) + orderItem.Quantity;
        }

        return quantities;
    }
}
