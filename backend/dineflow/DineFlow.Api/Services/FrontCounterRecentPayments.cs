using System.Linq.Expressions;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <summary>
/// Which counter payments the till can still put right.
/// </summary>
/// <remarks>
/// <para>
/// The void and offline-refund endpoints work from a payment id and never cared what state the order
/// reached. What was missing was any way to reach one: completing a pickup takes the order out of the
/// counter's working lists, and the reversal controls live on those lists — so a payment became
/// unreachable at precisely the moment a customer was most likely to come back about it, which is
/// after they have their food and are looking at their bank app.
/// </para>
/// <para>
/// Stated here rather than inside the controller so what the counter can reach is a thing a test can
/// check, instead of a second copy that agrees with the real query only until someone edits one.
/// </para>
/// </remarks>
public static class FrontCounterRecentPayments
{
    /// <summary>
    /// How far back the counter can reach.
    /// </summary>
    /// <remarks>
    /// Long enough for "they came back after lunch", short enough that this stays a counter tool and
    /// not an accounts ledger — the takings report is where the full record belongs.
    /// </remarks>
    public static readonly TimeSpan Window = TimeSpan.FromHours(24);

    /// <summary>The providers that mean money changed hands at this counter rather than online.</summary>
    public static readonly string[] Providers =
    [
        PaymentProviders.Counter,
        PaymentProviders.CounterCash,
        PaymentProviders.CounterCard
    ];

    /// <summary>
    /// Orders with a counter payment there is still something to do about.
    /// </summary>
    /// <remarks>
    /// Deliberately says nothing about the order's own status: a finished pickup is exactly the case
    /// this exists for. Money taken online is left out — reversing that is the payment provider's
    /// business, not the till's — and so is a payment already voided or fully refunded, which has
    /// nothing left to reverse and would only invite someone to try.
    /// </remarks>
    public static Expression<Func<Order, bool>> Predicate(Guid restaurantId, DateTime utcNow)
    {
        var since = utcNow - Window;

        return order =>
            order.RestaurantId == restaurantId &&
            order.Payments.Any(payment =>
                Providers.Contains(payment.Provider) &&
                (payment.Status == PaymentStatus.Paid ||
                 payment.Status == PaymentStatus.PartiallyRefunded) &&
                payment.CreatedAt >= since);
    }

    /// <summary>
    /// When this order's counter till last took money, used to put the newest first.
    /// </summary>
    /// <remarks>
    /// The payment being asked about is nearly always the last one taken, and a cashier with a
    /// customer in front of them should not have to read down a list to find it.
    /// </remarks>
    public static Expression<Func<Order, DateTime>> LastTakenAt() =>
        order => order.Payments
            .Where(payment => Providers.Contains(payment.Provider))
            .Max(payment => payment.CreatedAt);
}
