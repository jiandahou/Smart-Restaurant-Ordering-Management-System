namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// How much cash a till may accept against an order, and therefore how much change it may be told
/// to hand back.
/// </summary>
/// <remarks>
/// <para>
/// Only the lower bound was ever checked — the tender had to cover the bill. Nothing looked at the
/// other end, so A$5000.00 keyed against a A$24.00 order was accepted and the screen answered
/// "change A$4976.00". Dropping or adding a digit is the ordinary cashier slip, and the change due
/// is the number the cashier counts out of the drawer, so the mistake leaves as cash.
/// </para>
/// <para>
/// The ledger was never at risk: the payment still records the bill. What needed a bound was the
/// figure handed back.
/// </para>
/// <para>
/// The bound is on the change rather than on the tender, because that is where the harm is, and a
/// flat cap on the tender cannot tell A$100 for a A$5 coffee (ordinary) from A$5000 for a A$24 bill
/// (a slip). Change may run to <see cref="MaximumChangeDue"/>, or to the value of the bill itself
/// when that is larger — a big table settling a A$800 bill with A$1500 is still plainly real. A
/// refusal costs the cashier one re-entry; accepting costs the drawer.
/// </para>
/// </remarks>
public static class CounterCashTenderPolicy
{
    /// Generous next to any single serving, and well under a digit slip on one.
    public const decimal MaximumChangeDue = 500m;

    /// <summary>The most this order may hand back, given what is owed on it.</summary>
    public static decimal MaximumChangeFor(decimal amountDue) =>
        Math.Max(MaximumChangeDue, amountDue);

    /// <summary>
    /// True when <paramref name="amountReceived"/> is a tender the till may take: it covers the bill
    /// and does not leave more change than <see cref="MaximumChangeFor"/> allows.
    /// </summary>
    public static bool IsAcceptableTender(decimal amountReceived, decimal amountDue) =>
        amountReceived >= amountDue
        && amountReceived - amountDue <= MaximumChangeFor(amountDue);
}
