using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed class TableSessionService(AppDbContext dbContext)
{
    private static readonly OrderStatus[] ActiveStatuses =
    [
        OrderStatus.Pending,
        OrderStatus.Accepted,
        OrderStatus.Preparing,
        OrderStatus.Ready,
    ];

    /// <summary>
    /// The sitting a new order at this table belongs to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Any open session used to do, however old. A session closes only when the counter settles it,
    /// so anything else that ended the last order left one open and empty, and the next person to
    /// scan that code joined it — a table found here holding a session opened twenty-nine days
    /// earlier, with two strangers' orders still on the bill. A new diner's single plate landed on
    /// that bill as one more line, and the till read the total as one party's.
    /// </para>
    /// <para>
    /// So a session is now bounded by <see cref="TableServiceDay"/> as well as by settlement.
    /// </para>
    /// <para>
    /// With one exception, and it is deliberate. A stale session that still has live orders on it
    /// is not stale bookkeeping, it is a table with something unresolved on it — food never marked
    /// served, money never accounted for. Closing it would take those orders off the table view
    /// entirely, because the counter reads a table's active orders from its open session and its
    /// history from everything closed: an order that is neither would appear in neither. Hiding
    /// unresolved orders is a worse failure than the one being fixed, so that session is kept and a
    /// person has to deal with it.
    /// </para>
    /// </remarks>
    public async Task<TableSession> GetOrCreateOpenSessionAsync(
        Guid restaurantId,
        Guid tableId,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var session = await dbContext.TableSessions
            .FirstOrDefaultAsync(
                item =>
                    item.RestaurantId == restaurantId &&
                    item.TableId == tableId &&
                    item.Status == TableSessionStatus.Open,
                cancellationToken);

        if (session is not null)
        {
            if (await IsSameServiceAsync(restaurantId, session.OpenedAt, utcNow, cancellationToken))
            {
                return session;
            }

            if (await HasActiveOrdersAsync(session.Id, excludedOrderId: null, cancellationToken))
            {
                return session;
            }

            Close(session, utcNow);
        }

        session = new TableSession
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            TableId = tableId,
            Status = TableSessionStatus.Open,
            OpenedAt = utcNow,
            CreatedAt = utcNow
        };

        await dbContext.TableSessions.AddAsync(session, cancellationToken);
        return session;
    }

    /// <summary>
    /// Closes a session once nothing on it is live any more.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Only the counter used to do this, and only on the two paths where it settled or completed
    /// something. Every other way an order can stop being live — a customer cancelling, staff
    /// rejecting, an unpaid order timing out, a full refund calling it off — left the session open
    /// with nothing in it. That is how a dining room came to report six occupied tables with nobody
    /// sitting at any of them.
    /// </para>
    /// <para>
    /// Safe to call whenever an order leaves the live statuses, including when nothing changed.
    /// </para>
    /// </remarks>
    /// <param name="closingOrderId">
    /// The order being closed by the caller. Excluded from the count because callers usually reach
    /// here with the new status set in memory and not yet written, so the database would still
    /// report it live and the session would never close.
    /// </param>
    public async Task CloseIfNothingIsLiveAsync(
        Guid? sessionId,
        Guid? closingOrderId,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        if (!sessionId.HasValue)
        {
            return;
        }

        if (await HasActiveOrdersAsync(sessionId.Value, closingOrderId, cancellationToken))
        {
            return;
        }

        var session = await dbContext.TableSessions
            .FirstOrDefaultAsync(
                item => item.Id == sessionId.Value && item.Status == TableSessionStatus.Open,
                cancellationToken);

        if (session is null)
        {
            return;
        }

        Close(session, utcNow);
    }

    /// <summary>
    /// Whether a session opened then is still the same sitting, on this restaurant's own clock.
    /// </summary>
    /// <remarks>
    /// The zone is fetched here rather than asked of every caller. Three routes reach this — the
    /// counter, a QR scan, a checkout — and a parameter that all three have to remember to fill in
    /// correctly is a parameter one of them will eventually fill in with the server's own idea of
    /// midnight, which lands in the middle of dinner.
    /// </remarks>
    public async Task<bool> IsSameServiceAsync(
        Guid restaurantId,
        DateTime openedAtUtc,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var timezone = await dbContext.Restaurants
            .AsNoTracking()
            .Where(restaurant => restaurant.Id == restaurantId)
            .Select(restaurant => restaurant.Timezone)
            .FirstOrDefaultAsync(cancellationToken);

        return TableServiceDay.IsSameService(
            openedAtUtc,
            utcNow,
            string.IsNullOrWhiteSpace(timezone) ? "UTC" : timezone);
    }

    private Task<bool> HasActiveOrdersAsync(
        Guid sessionId,
        Guid? excludedOrderId,
        CancellationToken cancellationToken) =>
        dbContext.Orders
            .AnyAsync(
                order =>
                    order.TableSessionId == sessionId &&
                    (excludedOrderId == null || order.Id != excludedOrderId) &&
                    ActiveStatuses.Contains(order.Status),
                cancellationToken);

    private static void Close(TableSession session, DateTime utcNow)
    {
        session.Status = TableSessionStatus.Closed;
        session.ClosedAt = utcNow;
        session.UpdatedAt = utcNow;
    }

    public static bool IsActiveOrder(Order order) =>
        order.Status is not
            OrderStatus.Completed and not
            OrderStatus.Cancelled and not
            OrderStatus.Rejected;
}
