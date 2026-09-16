using System.Reflection;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Orders;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A till may not be told to hand back more than an order could plausibly owe.
///
/// <para>
/// Only the floor was checked — the tender had to cover the bill — so A$5000.00 keyed against a
/// A$24.00 order was accepted and answered "change A$4976.00", and A$1e15 was accepted too. The
/// payment row stayed correct at A$24.00 throughout; what was wrong was the figure the cashier
/// counts out of the drawer. Every other money input on the screen already had a ceiling: refunds
/// cannot exceed what is refundable, and a table settles for what the table owes.
/// </para>
/// </summary>
public sealed class CounterCashTenderPolicyTests
{
    [Theory]
    [InlineData(24, 24)]        // exact
    [InlineData(24, 100)]       // a note
    [InlineData(5, 100)]        // a note for a coffee: 20x the bill, and entirely ordinary
    [InlineData(24, 524)]       // exactly at the ceiling
    [InlineData(800, 1600)]     // a big bill raises its own ceiling
    public void AcceptsTheOrdinaryWaysPeoplePayCash(decimal amountDue, decimal received)
        => Assert.True(CounterCashTenderPolicy.IsAcceptableTender(received, amountDue));

    [Theory]
    [InlineData(24, 23.99)]             // short
    [InlineData(24, 5000)]              // the reported slip
    [InlineData(24, 524.01)]            // one cent past the ceiling
    [InlineData(24, 1000000000000000)]  // the reported absurd value
    [InlineData(800, 1600.01)]
    public void RefusesWhatTheDrawerCouldNotGiveBack(decimal amountDue, decimal received)
        => Assert.False(CounterCashTenderPolicy.IsAcceptableTender(received, amountDue));

    [Theory]
    [InlineData(0, 500)]
    [InlineData(24, 500)]
    [InlineData(499.99, 500)]
    [InlineData(800, 800)]
    public void CeilingIsTheGreaterOfTheFlatCapAndTheBill(decimal amountDue, decimal expected)
        => Assert.Equal(expected, CounterCashTenderPolicy.MaximumChangeFor(amountDue));

    /// <summary>
    /// Both tills go through the same check. The table path settles every order on the session at
    /// once, so an unbounded tender there is a slip against the whole table's bill rather than one
    /// order's.
    /// </summary>
    [Theory]
    [InlineData("Cash", 5000d, false)]
    [InlineData("Cash", 100d, true)]
    [InlineData("Card", null, true)]
    public void ValidateTender_AppliesThePolicyToEveryCounterPath(
        string tender,
        double? received,
        bool expectedToPass)
    {
        var method = typeof(StaffFrontCounterController)
            .GetMethod("ValidateTender", BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(method);

        var controller = (StaffFrontCounterController)System.Runtime.CompilerServices
            .RuntimeHelpers.GetUninitializedObject(typeof(StaffFrontCounterController));
        controller.ControllerContext = new ControllerContext();

        decimal? amountReceived = received.HasValue ? (decimal)received.Value : null;
        var result = method!.Invoke(controller, [tender, amountReceived, 24m]);

        var error = result!.GetType().GetField("Item4")!.GetValue(result);
        Assert.Equal(expectedToPass, error is null);
    }
}
