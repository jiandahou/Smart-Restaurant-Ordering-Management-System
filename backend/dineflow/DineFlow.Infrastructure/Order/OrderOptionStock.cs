namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// How many units of each tracked modifier an order consumes.
/// </summary>
/// <remarks>
/// <para>
/// The multiplication is the whole difficulty. Two spring rolls each taking three extra rolls consume
/// six — not two, and not three. Counted unmultiplied, a tracked modifier oversells while every line
/// on the order reads correctly on its own, which is the hardest kind of shortage to explain
/// afterwards.
/// </para>
/// <para>
/// Stated here rather than inside a controller so the reservation, the release and the sweeper all
/// count the same way; three copies of an arithmetic rule is three chances to get it wrong once.
/// </para>
/// </remarks>
public static class OrderOptionStock
{
    public static Dictionary<Guid, int> RequestedQuantities(IEnumerable<OrderItem> orderItems)
    {
        var quantities = new Dictionary<Guid, int>();

        foreach (var orderItem in orderItems)
        {
            foreach (var option in orderItem.SelectedOptions)
            {
                // A snapshot of a modifier that has since been deleted has nothing left to reserve
                // against.
                if (option.MenuItemOptionId is not { } optionId)
                {
                    continue;
                }

                quantities[optionId] =
                    quantities.GetValueOrDefault(optionId) + orderItem.Quantity * option.Quantity;
            }
        }

        return quantities;
    }
}
