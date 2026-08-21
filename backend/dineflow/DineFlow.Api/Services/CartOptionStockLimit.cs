using DineFlow.Infrastructure.Carts;

namespace DineFlow.Api.Services;

/// <summary>
/// Whether a cart may hold this many of a tracked modifier.
/// </summary>
/// <remarks>
/// <para>
/// The dish had this check and its modifiers did not, so a customer could put three portions of a
/// sauce with two left into their cart, choose everything else, and be turned away at payment by a
/// shortage the menu had known about the whole time. A modifier can run out exactly as a dish can;
/// only one of them was saying so.
/// </para>
/// <para>
/// Two limits apply and they are not the same limit. <c>MaxQuantity</c> is a recipe rule — at most
/// two lots of truffle on one garlic bread, however much truffle is in the kitchen. Stock is what is
/// left. A modifier allowing three per item with two in stock is refused at three, and neither
/// number alone explains why.
/// </para>
/// <para>
/// Multiplied by the dish quantity, for the same reason
/// <see cref="DineFlow.Infrastructure.Orders.OrderOptionStock"/> multiplies: two garlic breads each
/// taking two lots of truffle consume four. Counted unmultiplied a modifier oversells while every
/// line reads correctly on its own.
/// </para>
/// <para>
/// Like <see cref="CartStockLimit"/> this is a warning, not a reservation — stock is held at
/// checkout, so two carts can still both pass and one lose. Losing at checkout is far better than
/// filling a cart in ignorance.
/// </para>
/// </remarks>
public static class CartOptionStockLimit
{
    /// <summary>A modifier being asked for, and what the kitchen has left of it.</summary>
    /// <param name="PerItem">How many lots of it go on one dish.</param>
    public readonly record struct Request(Guid OptionId, string Name, int? StockQuantity, int PerItem);

    /// <summary>A modifier there is not enough of, and the numbers that say so.</summary>
    public readonly record struct Shortage(string Name, int Remaining, int Wanted, int ElsewhereInCart);

    /// <summary>
    /// How many units of each tracked modifier the given cart lines already commit.
    /// </summary>
    /// <remarks>
    /// A line stores its modifiers as repeated ids, so a line of two dishes each taking three lots
    /// carries the id three times and counts as six.
    /// </remarks>
    public static Dictionary<Guid, int> UnitsInCart(IEnumerable<CartItem> lines)
    {
        var units = new Dictionary<Guid, int>();

        foreach (var line in lines)
        {
            foreach (var optionId in line.SelectedOptionIds)
            {
                units[optionId] = units.GetValueOrDefault(optionId) + line.Quantity;
            }
        }

        return units;
    }

    /// <summary>
    /// Which of the requested modifiers the cart cannot have this many of.
    /// </summary>
    /// <param name="requested">The modifiers chosen for this line.</param>
    /// <param name="dishQuantity">How many of the dish the line will hold.</param>
    /// <param name="elsewhereInCart">Units already committed by the cart's other lines.</param>
    public static IReadOnlyList<Shortage> Evaluate(
        IEnumerable<Request> requested,
        int dishQuantity,
        IReadOnlyDictionary<Guid, int>? elsewhereInCart = null)
    {
        var shortages = new List<Shortage>();

        foreach (var request in requested)
        {
            if (request.StockQuantity is not { } stock)
            {
                // Not limited: there is nothing to run out of.
                continue;
            }

            var remaining = Math.Max(0, stock);
            var committed = elsewhereInCart?.GetValueOrDefault(request.OptionId) ?? 0;
            var wanted = committed + Math.Max(0, dishQuantity) * Math.Max(0, request.PerItem);

            if (wanted > remaining)
            {
                shortages.Add(new Shortage(request.Name, remaining, wanted, committed));
            }
        }

        return shortages;
    }

    /// <summary>A sentence a customer can act on, naming the modifier and what is actually left.</summary>
    public static string DescribeRefusal(IReadOnlyList<Shortage> shortages) =>
        string.Join(" ", shortages.Select(Describe));

    private static string Describe(Shortage shortage)
    {
        if (shortage.Remaining == 0)
        {
            return $"'{shortage.Name}' has just sold out.";
        }

        var left = shortage.Remaining == 1 ? "1 left" : $"{shortage.Remaining} left";

        return shortage.ElsewhereInCart > 0
            ? $"Only {left} of '{shortage.Name}', and your cart already uses {shortage.ElsewhereInCart}."
            : $"Only {left} of '{shortage.Name}', and you asked for {shortage.Wanted}.";
    }
}
