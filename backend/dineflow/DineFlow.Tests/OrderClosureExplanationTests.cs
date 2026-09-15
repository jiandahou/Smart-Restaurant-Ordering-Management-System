using DineFlow.Infrastructure.Orders;
using Xunit;

using OrderEntity = DineFlow.Infrastructure.Orders.Order;

namespace DineFlow.Tests;

/// <summary>
/// Staff already choose a reason when they turn an order away — "Item is unavailable", "Duplicate
/// order" — and it was written to the order's history and went no further. The customer watched
/// their order become Rejected with nothing beside it, at the moment the reason matters most:
/// whether to order again without that dish, or not to bother.
/// </summary>
public class OrderClosureExplanationTests
{
    private static OrderEntity Order(
        OrderStatus status,
        string? customerId = null,
        params OrderStatusHistory[] history)
    {
        var order = new OrderEntity
        {
            Id = Guid.NewGuid(),
            OrderNumber = "ORD-1",
            Status = status,
            CustomerId = customerId,
        };

        foreach (var entry in history)
        {
            order.StatusHistory.Add(entry);
        }

        return order;
    }

    private static OrderStatusHistory Transition(
        OrderStatus to,
        string action,
        string? reason,
        DateTime at,
        string? changedBy = null) => new()
        {
            NewStatus = to,
            Action = action,
            Reason = reason,
            CreatedAt = at,
            ChangedByUserId = changedBy,
        };

    [Fact]
    public void AnOpenOrderHasNothingToExplain()
    {
        var order = Order(
            OrderStatus.Preparing,
            history: Transition(OrderStatus.Accepted, "Accept", null, new DateTime(2026, 8, 14, 9, 0, 0)));

        Assert.Null(OrderClosureExplanation.Find(order));
    }

    [Fact]
    public void ARejectedOrderCarriesTheReasonStaffChose()
    {
        var order = Order(
            OrderStatus.Rejected,
            history: Transition(OrderStatus.Rejected, "Reject", "Item is unavailable", new DateTime(2026, 8, 14, 9, 5, 0), "staff-1"));

        var closure = OrderClosureExplanation.Find(order);

        Assert.NotNull(closure);
        Assert.Equal("Item is unavailable", closure!.Reason);
        Assert.Equal("Reject", closure.Action);
    }

    /// <summary>
    /// An order passes through several transitions, and an earlier one says nothing about why it
    /// finished the way it did.
    /// </summary>
    [Fact]
    public void ItIsTheTransitionThatClosedTheOrder()
    {
        var order = Order(
            OrderStatus.Cancelled,
            history:
            [
                Transition(OrderStatus.Accepted, "Accept", "Looks fine", new DateTime(2026, 8, 14, 9, 0, 0), "staff-1"),
                Transition(OrderStatus.Cancelled, "Cancel", "Kitchen closed early", new DateTime(2026, 8, 14, 9, 30, 0), "staff-1"),
            ]);

        Assert.Equal("Kitchen closed early", OrderClosureExplanation.Find(order)!.Reason);
    }

    /// <summary>Two closing entries can exist; the latest is the one that stands.</summary>
    [Fact]
    public void TheLatestClosureWins()
    {
        var order = Order(
            OrderStatus.Cancelled,
            history:
            [
                Transition(OrderStatus.Cancelled, "Cancel", "First attempt", new DateTime(2026, 8, 14, 9, 0, 0), "staff-1"),
                Transition(OrderStatus.Cancelled, "Cancel", "Corrected reason", new DateTime(2026, 8, 14, 9, 10, 0), "staff-1"),
            ]);

        Assert.Equal("Corrected reason", OrderClosureExplanation.Find(order)!.Reason);
    }

    /// <summary>
    /// Telling a customer "the restaurant cancelled this" when they cancelled it themselves would
    /// be a small lie with a real cost — they would ring up to ask why.
    /// </summary>
    [Fact]
    public void ACustomerCancellingTheirOwnOrderIsAttributedToThem()
    {
        var order = Order(
            OrderStatus.Cancelled,
            customerId: "customer-9",
            history: Transition(OrderStatus.Cancelled, "Cancel", "Changed my mind", new DateTime(2026, 8, 14, 9, 0, 0), "customer-9"));

        var closure = OrderClosureExplanation.Find(order)!;

        Assert.True(OrderClosureExplanation.EndedByCustomer(order, closure));
    }

    [Fact]
    public void StaffTurningAnOrderAwayIsNotAttributedToTheCustomer()
    {
        var order = Order(
            OrderStatus.Rejected,
            customerId: "customer-9",
            history: Transition(OrderStatus.Rejected, "Reject", "Item is unavailable", new DateTime(2026, 8, 14, 9, 0, 0), "staff-1"));

        var closure = OrderClosureExplanation.Find(order)!;

        Assert.False(OrderClosureExplanation.EndedByCustomer(order, closure));
    }

    /// <summary>
    /// A guest has no account to compare against, so the actor is the only signal: staff
    /// transitions are always attributed, and a guest cancelling their own order is not.
    /// </summary>
    [Fact]
    public void AGuestCancellingTheirOwnOrderIsAttributedToThem()
    {
        var order = Order(
            OrderStatus.Cancelled,
            history: Transition(OrderStatus.Cancelled, "Cancel", "Cancelled by customer.", new DateTime(2026, 8, 14, 9, 0, 0)));

        var closure = OrderClosureExplanation.Find(order)!;

        Assert.True(OrderClosureExplanation.EndedByCustomer(order, closure));
    }

    [Fact]
    public void AGuestOrderStaffRejectedIsNotAttributedToTheGuest()
    {
        var order = Order(
            OrderStatus.Rejected,
            history: Transition(OrderStatus.Rejected, "Reject", "Item is unavailable", new DateTime(2026, 8, 14, 9, 0, 0), "staff-1"));

        var closure = OrderClosureExplanation.Find(order)!;

        Assert.False(OrderClosureExplanation.EndedByCustomer(order, closure));
    }

    /// <summary>
    /// A closed order whose history was never loaded has no reason to show. Reporting nothing is
    /// right; inventing one would be worse than silence.
    /// </summary>
    [Fact]
    public void AClosedOrderWithNoHistoryExplainsNothing()
    {
        Assert.Null(OrderClosureExplanation.Find(Order(OrderStatus.Rejected)));
    }
}
