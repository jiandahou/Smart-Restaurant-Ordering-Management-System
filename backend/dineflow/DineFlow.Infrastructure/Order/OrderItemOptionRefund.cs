using DineFlow.Infrastructure.Menu;

namespace DineFlow.Infrastructure.Orders;

/// <summary>Why a modifier cannot be refunded on its own, or null when it can.</summary>
public enum OptionRefundIneligibility
{
    /// <summary>The modifier replaced the line's price rather than adding to it.</summary>
    ReplacesTheLinePrice,

    /// <summary>The modifier lowered the price; refunding it would return a discount.</summary>
    IsADiscount,

    /// <summary>Free, so there is nothing of it to give back.</summary>
    CostsNothing,

    /// <summary>The order predates the adjustment-type snapshot, so its share cannot be worked out.</summary>
    AdjustmentTypeUnknown,

    /// <summary>The line's own price does not equal its parts, so no part of it can be priced.</summary>
    LineDoesNotReconcile,
}

/// <summary>
/// What one modifier contributed to a line, and whether that contribution can be refunded by itself.
/// </summary>
/// <remarks>
/// <para>
/// A line's unit price is not the dish price with modifiers alongside it — they are already inside
/// it, applied by <see cref="PricingCalculator.CalculateUnitPrice"/> at checkout. Refunding a
/// modifier is therefore a partition of the line's own amount rather than a second kind of money,
/// and the line's balance stays the ceiling over whatever the parts add up to.
/// </para>
/// <para>
/// Three kinds of modifier have no share to return. A <c>Replace</c> does not adjust the price, it
/// becomes it, discarding the base and everything chosen before it — there is no part of the line
/// that is "the Replace", so refunding it would mean refunding the dish. A <c>Remove</c> lowers the
/// price, so its share is money the customer never paid. And a free modifier contributed nothing.
/// </para>
/// <para>
/// The rest is about what can be proved rather than what is true. An order placed before the
/// adjustment type was snapshotted cannot have its modifiers priced at all, and a line whose unit
/// price does not equal its base plus its adjustments was not produced by the calculator, so its
/// parts do not describe it. Both decline instead of guessing: a modifier refund is money leaving
/// on the strength of an arithmetic claim, and a claim that cannot be checked should not be made.
/// </para>
/// </remarks>
public static class OrderItemOptionRefund
{
    /// <summary>
    /// What this modifier added to the line, in minor units.
    /// </summary>
    /// <remarks>
    /// Multiplied by both quantities for the same reason
    /// <see cref="OrderOptionStock.RequestedQuantities"/> multiplies: two garlic breads each taking
    /// two lots of truffle carry four lots of truffle's price. Counted once, a modifier on a line of
    /// three would be refundable for a third of what the customer actually paid for it.
    /// </remarks>
    public static long ContributionCents(OrderItemOption option, int lineQuantity) =>
        PricingCalculator.ToMinorCurrencyUnits(
            option.PriceAdjustmentSnapshot * option.Quantity * lineQuantity);

    /// <summary>
    /// Whether the line's recorded price is the one its parts describe.
    /// </summary>
    /// <remarks>
    /// A <c>Replace</c> among the options makes this false by construction, which is the intended
    /// answer: after a Replace the base price and the earlier adjustments are not in the unit price
    /// any more, so no modifier on that line has a share that can be named.
    /// </remarks>
    public static bool LineReconciles(OrderItem orderItem)
    {
        var adjustments = orderItem.SelectedOptions
            .Sum(option => option.PriceAdjustmentSnapshot * option.Quantity);

        return orderItem.UnitPrice == orderItem.BasePriceSnapshot + adjustments;
    }

    /// <summary>
    /// Whether this modifier may be refunded on its own, and why not when it may not.
    /// </summary>
    public static OptionRefundIneligibility? WhyNotRefundable(OrderItem orderItem, OrderItemOption option) =>
        option.AdjustmentTypeSnapshot switch
        {
            null => OptionRefundIneligibility.AdjustmentTypeUnknown,
            OptionAdjustmentType.Replace => OptionRefundIneligibility.ReplacesTheLinePrice,
            OptionAdjustmentType.Remove => OptionRefundIneligibility.IsADiscount,
            _ when option.PriceAdjustmentSnapshot <= 0 => OptionRefundIneligibility.CostsNothing,
            _ when !LineReconciles(orderItem) => OptionRefundIneligibility.LineDoesNotReconcile,
            _ => null,
        };

    public static bool IsRefundable(OrderItem orderItem, OrderItemOption option) =>
        WhyNotRefundable(orderItem, option) is null;

    /// <summary>The wording a customer or a member of staff is shown, naming the modifier.</summary>
    public static string Explain(OptionRefundIneligibility reason, string optionName) => reason switch
    {
        OptionRefundIneligibility.ReplacesTheLinePrice =>
            $"\"{optionName}\" sets the price of the whole item, so it cannot be refunded on its own.",
        OptionRefundIneligibility.IsADiscount =>
            $"\"{optionName}\" reduced the price, so there is nothing to refund for it.",
        OptionRefundIneligibility.CostsNothing =>
            $"\"{optionName}\" was free, so there is nothing to refund for it.",
        OptionRefundIneligibility.AdjustmentTypeUnknown =>
            $"This order predates itemised extras, so \"{optionName}\" can only be refunded as part of the whole item.",
        OptionRefundIneligibility.LineDoesNotReconcile =>
            $"The price of this item cannot be split into its extras, so \"{optionName}\" can only be refunded as part of the whole item.",
        _ => $"\"{optionName}\" cannot be refunded on its own.",
    };
}
