using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Money the restaurant is holding from customers it turned away, counted for the operations bell.
/// </summary>
/// <remarks>
/// <para>
/// Distinct from the pending refund <em>requests</em> already on the bell, and the difference is the
/// whole point of counting it. A request is a customer who noticed and asked. This is the case where
/// nobody asked — the restaurant cancelled or rejected an order that had already been paid for, and
/// the customer may not yet know their money was taken. It is the one of the two that nobody is
/// chasing from the other end.
/// </para>
/// <para>
/// Until now it appeared only as individual cards inside a queue that also holds live orders waiting
/// on payment, with no count, no total and no age. Something that reads as one item among forty is
/// not being surfaced; it is being filed.
/// </para>
/// </remarks>
public static class RefundsOwedQuery
{
    /// <summary>The same rule as <see cref="TurnedAwayOrderRefund.AmountOwedCents"/>, asked of the database.</summary>
    /// <remarks>
    /// Stated once, here, so the badge and the refund cannot come to disagree about which orders owe
    /// money — a count assembled a second way sends someone to a screen to find something that is
    /// not there, and after that they stop believing the badge.
    /// </remarks>
    public static IQueryable<Order> TurnedAwayStillHoldingMoney(IQueryable<Order> orders) =>
        orders.Where(order =>
            (order.Status == OrderStatus.Cancelled || order.Status == OrderStatus.Rejected)
            && order.PaymentMethod == PaymentMethod.Online
            && order.Payments
                .Where(payment => payment.Status == PaymentStatus.Paid
                    || payment.Status == PaymentStatus.PartiallyRefunded)
                .Sum(payment => payment.AmountCents - payment.Refunds
                    .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                    .Sum(refund => refund.AmountCents)) > 0);

    /// <summary>What one restaurant owes back, and since when.</summary>
    public readonly record struct RefundsOwed(int Count, long AmountCents, DateTime? OldestTakenAt)
    {
        public static readonly RefundsOwed None = new(0, 0, null);
    }

    /// <summary>
    /// The age is measured from when the money was taken, not from when the order was closed.
    /// </summary>
    /// <remarks>
    /// It is the customer's clock that matters here, and what they are counting is how long the
    /// restaurant has had their money. Closing time also moves whenever anything else touches the
    /// order, which would quietly reset an age that is supposed to be climbing.
    /// </remarks>
    public static async Task<IReadOnlyDictionary<Guid, RefundsOwed>> ByRestaurantAsync(
        AppDbContext dbContext,
        IReadOnlyCollection<Guid> restaurantIds,
        CancellationToken cancellationToken)
    {
        if (restaurantIds.Count == 0)
        {
            return new Dictionary<Guid, RefundsOwed>();
        }

        var rows = await TurnedAwayStillHoldingMoney(dbContext.Orders.AsNoTracking())
            .Where(order => order.RestaurantId != null && restaurantIds.Contains(order.RestaurantId.Value))
            .Select(order => new
            {
                RestaurantId = order.RestaurantId!.Value,
                OwedCents = order.Payments
                    .Where(payment => payment.Status == PaymentStatus.Paid
                        || payment.Status == PaymentStatus.PartiallyRefunded)
                    .Sum(payment => payment.AmountCents - payment.Refunds
                        .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                        .Sum(refund => refund.AmountCents)),
                TakenAt = order.Payments
                    .Where(payment => payment.Status == PaymentStatus.Paid
                        || payment.Status == PaymentStatus.PartiallyRefunded)
                    .Min(payment => payment.PaidAt),
            })
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(row => row.RestaurantId)
            .ToDictionary(
                group => group.Key,
                group => new RefundsOwed(
                    group.Count(),
                    group.Sum(row => row.OwedCents),
                    group.Select(row => row.TakenAt).Where(taken => taken.HasValue).Min()));
    }
}
