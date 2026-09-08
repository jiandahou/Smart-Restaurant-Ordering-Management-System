using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// What one modifier contributed to a line, and whether that share can be returned by itself.
/// </summary>
/// <remarks>
/// A modifier refund is money leaving on the strength of an arithmetic claim about a price that was
/// agreed months ago. Every case below is one where the claim cannot be made, and the answer is to
/// decline rather than to approximate.
/// </remarks>
public class OrderItemOptionRefundTests
{
    private static OrderItem Line(
        decimal basePrice,
        decimal unitPrice,
        int quantity,
        params OrderItemOption[] options)
    {
        var item = new OrderItem
        {
            BasePriceSnapshot = basePrice,
            UnitPrice = unitPrice,
            Quantity = quantity,
        };

        foreach (var option in options)
        {
            item.SelectedOptions.Add(option);
        }

        return item;
    }

    private static OrderItemOption Option(
        decimal adjustment,
        OptionAdjustmentType? type = OptionAdjustmentType.Add,
        int quantity = 1,
        string name = "Truffle") =>
        new()
        {
            OptionNameSnapshot = name,
            PriceAdjustmentSnapshot = adjustment,
            AdjustmentTypeSnapshot = type,
            Quantity = quantity,
        };

    /// <summary>
    /// Both quantities count. Two garlic breads each taking two lots of truffle carry four lots of
    /// truffle's price; counted once, the customer could reclaim a quarter of what they paid for it.
    /// </summary>
    [Fact]
    public void ContributionMultipliesByBothQuantities()
    {
        var truffle = Option(3.00m, quantity: 2);

        Assert.Equal(1_200, OrderItemOptionRefund.ContributionCents(truffle, lineQuantity: 2));
        Assert.Equal(600, OrderItemOptionRefund.ContributionCents(truffle, lineQuantity: 1));
    }

    [Fact]
    public void AnOrdinaryPaidExtraIsRefundable()
    {
        var truffle = Option(3.00m);
        var line = Line(basePrice: 8.50m, unitPrice: 11.50m, quantity: 1, truffle);

        Assert.Null(OrderItemOptionRefund.WhyNotRefundable(line, truffle));
        Assert.True(OrderItemOptionRefund.IsRefundable(line, truffle));
    }

    /// <summary>A Replace does not adjust the price, it becomes it. There is no share to return.</summary>
    [Fact]
    public void AReplaceHasNoShareOfTheLine()
    {
        var upgrade = Option(20.00m, OptionAdjustmentType.Replace, name: "Lobster upgrade");
        var line = Line(basePrice: 8.50m, unitPrice: 20.00m, quantity: 1, upgrade);

        Assert.Equal(
            OptionRefundIneligibility.ReplacesTheLinePrice,
            OrderItemOptionRefund.WhyNotRefundable(line, upgrade));
    }

    /// <summary>Refunding a discount returns money the customer never paid.</summary>
    [Fact]
    public void ARemoveIsADiscountAndNotRefundable()
    {
        var noCheese = Option(-1.00m, OptionAdjustmentType.Remove, name: "No cheese");
        var line = Line(basePrice: 8.50m, unitPrice: 7.50m, quantity: 1, noCheese);

        Assert.Equal(
            OptionRefundIneligibility.IsADiscount,
            OrderItemOptionRefund.WhyNotRefundable(line, noCheese));
    }

    [Fact]
    public void AFreeExtraHasNothingToRefund()
    {
        var mild = Option(0m, name: "Mild");
        var line = Line(basePrice: 8.50m, unitPrice: 8.50m, quantity: 1, mild);

        Assert.Equal(
            OptionRefundIneligibility.CostsNothing,
            OrderItemOptionRefund.WhyNotRefundable(line, mild));
    }

    /// <summary>
    /// An order placed before the type was snapshotted cannot have its modifiers priced. Add is the
    /// common case and assuming it would be right most of the time, which is not good enough to
    /// send money on.
    /// </summary>
    [Fact]
    public void AnUnknownAdjustmentTypeDeclinesRatherThanAssumesAdd()
    {
        var legacy = Option(3.00m, type: null);
        var line = Line(basePrice: 8.50m, unitPrice: 11.50m, quantity: 1, legacy);

        Assert.Equal(
            OptionRefundIneligibility.AdjustmentTypeUnknown,
            OrderItemOptionRefund.WhyNotRefundable(line, legacy));
    }

    /// <summary>
    /// If the recorded unit price is not base plus adjustments, the line was not priced by the
    /// calculator and its parts do not describe it. Thirteen such rows exist in this database.
    /// </summary>
    [Fact]
    public void ALineWhosePriceIsNotItsPartsCannotBeSplit()
    {
        var truffle = Option(3.00m);
        var line = Line(basePrice: 450.00m, unitPrice: 16.67m, quantity: 1, truffle);

        Assert.False(OrderItemOptionRefund.LineReconciles(line));
        Assert.Equal(
            OptionRefundIneligibility.LineDoesNotReconcile,
            OrderItemOptionRefund.WhyNotRefundable(line, truffle));
    }

    /// <summary>
    /// A Replace alongside other extras takes the whole line out of reach, including the extras that
    /// would otherwise have qualified: after it, their adjustments are no longer in the price.
    /// </summary>
    [Fact]
    public void AReplaceTakesTheWholeLineOutOfReach()
    {
        var truffle = Option(3.00m);
        var upgrade = Option(20.00m, OptionAdjustmentType.Replace, name: "Lobster upgrade");
        var line = Line(basePrice: 8.50m, unitPrice: 20.00m, quantity: 1, truffle, upgrade);

        Assert.Equal(
            OptionRefundIneligibility.LineDoesNotReconcile,
            OrderItemOptionRefund.WhyNotRefundable(line, truffle));
        Assert.Equal(
            OptionRefundIneligibility.ReplacesTheLinePrice,
            OrderItemOptionRefund.WhyNotRefundable(line, upgrade));
    }

    [Fact]
    public void EveryRefusalNamesTheModifier()
    {
        foreach (var reason in Enum.GetValues<OptionRefundIneligibility>())
        {
            Assert.Contains("Truffle", OrderItemOptionRefund.Explain(reason, "Truffle"));
        }
    }
}

/// <summary>
/// The rule that keeps the two ways of refunding a line from paying for the same thing twice.
/// </summary>
public class LineRefundGranularityTests
{
    [Fact]
    public void AnUntouchedLineMayBeRefundedEitherWay()
    {
        var settled = LineRefundGranularityPolicy.Settled([]);

        Assert.Equal(LineRefundGranularity.Untouched, settled);
        Assert.True(LineRefundGranularityPolicy.AllowsWholeLineRefund(settled));
        Assert.True(LineRefundGranularityPolicy.AllowsModifierRefund(settled));
    }

    /// <summary>
    /// The trap this rule closes: a line-level refund spends the line's balance and no modifier's,
    /// so refunding the truffle by name afterwards would return it a second time.
    /// </summary>
    [Fact]
    public void ALineRefundedAsAWholeCannotThenHaveItsExtrasRefunded()
    {
        var settled = LineRefundGranularityPolicy.Settled([false]);

        Assert.Equal(LineRefundGranularity.AsAWhole, settled);
        Assert.False(LineRefundGranularityPolicy.AllowsModifierRefund(settled));
        Assert.True(LineRefundGranularityPolicy.AllowsWholeLineRefund(settled));
    }

    [Fact]
    public void ALineRefundedByItsPartsCannotThenBeRefundedWhole()
    {
        var settled = LineRefundGranularityPolicy.Settled([true, true]);

        Assert.Equal(LineRefundGranularity.ByItsParts, settled);
        Assert.False(LineRefundGranularityPolicy.AllowsWholeLineRefund(settled));
        Assert.True(LineRefundGranularityPolicy.AllowsModifierRefund(settled));
    }

    /// <summary>
    /// Rows predating the rule can carry both. Reporting the coarser grain stops such a line being
    /// split any further, which is the safe direction: no modifier balance is spent on trust.
    /// </summary>
    [Fact]
    public void ALineCarryingBothIsTreatedAsRefundedWhole()
    {
        Assert.Equal(LineRefundGranularity.AsAWhole, LineRefundGranularityPolicy.Settled([true, false]));
        Assert.Equal(LineRefundGranularity.AsAWhole, LineRefundGranularityPolicy.Settled([false, true]));
    }

    [Fact]
    public void BothRefusalsNameTheItem()
    {
        Assert.Contains("Garlic Bread", LineRefundGranularityPolicy.ExplainWholeLineRefused("Garlic Bread"));
        Assert.Contains("Garlic Bread", LineRefundGranularityPolicy.ExplainModifierRefused("Garlic Bread"));
    }
}
