using System.Reflection;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Asking for an extra back without saying how many was answered with a 500.
///
/// <para>
/// A refund request names order lines, and each selection carries a quantity. The whole-line branch
/// checks that quantity and refuses a zero with a plain 400. The extras branch never looked at it:
/// an extra is priced from its own contribution rather than from this number, so nothing further
/// down the method objected either, and the request was built and saved. The stored row is
/// constrained to a positive quantity, so PostgreSQL raised 23514 and the customer was told about
/// their omitted field as a server error.
/// </para>
/// <para>
/// Found on production Sandbox while reconciling a real partial refund: the same omission produced
/// a 400 for a dish and a 500 for the truffle on it. DineFlow's own web client always sends 1 for
/// an extra, so the defect is reachable only by another caller — which the contract invites, since
/// the amount field is documented as optional for exactly that reason.
/// </para>
/// </summary>
public sealed class ModifierRefundQuantityTests
{
    private static readonly MethodInfo Validate =
        typeof(OrderController).GetMethod(
            "ValidateModifierSelection",
            BindingFlags.NonPublic | BindingFlags.Static)
        ?? throw new InvalidOperationException("ValidateModifierSelection was not found.");

    /// <summary>The reported case: the field left out entirely, which binds as zero.</summary>
    [Fact]
    public void AnOmittedQuantityIsRefusedInsteadOfReachingTheDatabase()
    {
        var (orderItem, option) = BuildLineWithAnExtra();

        var refusal = Run(orderItem, option, quantity: 0);

        Assert.NotNull(refusal);
        Assert.Contains("Truffle", refusal);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void ANegativeQuantityIsRefused(int quantity)
    {
        var (orderItem, option) = BuildLineWithAnExtra();

        Assert.NotNull(Run(orderItem, option, quantity));
    }

    /// <summary>The extras branch is held to the same ceiling as the line it sits on.</summary>
    [Fact]
    public void MoreExtrasThanTheLineHasIsRefused()
    {
        var (orderItem, option) = BuildLineWithAnExtra(lineQuantity: 2);

        Assert.Null(Run(orderItem, option, quantity: 2));
        Assert.NotNull(Run(orderItem, option, quantity: 3));
    }

    /// <summary>What the web client sends, and what the production run actually refunded.</summary>
    [Fact]
    public void OneOfAnExtraOnALineOfOneIsAccepted()
    {
        var (orderItem, option) = BuildLineWithAnExtra();

        Assert.Null(Run(orderItem, option, quantity: 1));
    }

    private static string? Run(OrderItem orderItem, OrderItemOption option, int quantity) =>
        (string?)Validate.Invoke(null,
        [
            orderItem,
            option.Id,
            LineRefundGranularity.Untouched,
            new CreateRefundRequestItemInput
            {
                OrderItemId = orderItem.Id,
                OrderItemOptionId = option.Id,
                Quantity = quantity
            },
            new Dictionary<Guid, long>()
        ]);

    /// <summary>
    /// A dish at 20.00 carrying a 5.00 extra. The unit price has to equal the base plus the
    /// adjustments or the extra is unpriceable and the earlier gates refuse it for that instead.
    /// </summary>
    private static (OrderItem OrderItem, OrderItemOption Option) BuildLineWithAnExtra(int lineQuantity = 1)
    {
        var orderItem = new OrderItem
        {
            Id = Guid.NewGuid(),
            MenuItemNameSnapshot = "Refund probe",
            BasePriceSnapshot = 20.00m,
            UnitPrice = 25.00m,
            Quantity = lineQuantity
        };

        var option = new OrderItemOption
        {
            Id = Guid.NewGuid(),
            OrderItemId = orderItem.Id,
            MenuItemOptionId = Guid.NewGuid(),
            GroupNameSnapshot = "Extras",
            OptionNameSnapshot = "Truffle",
            PriceAdjustmentSnapshot = 5.00m,
            AdjustmentTypeSnapshot = OptionAdjustmentType.Add,
            Quantity = 1
        };

        orderItem.SelectedOptions.Add(option);
        return (orderItem, option);
    }
}
