using System.Linq.Expressions;
using DineFlow.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// The queues the staff order screen divides its work into.
/// </summary>
/// <remarks>
/// <para>
/// The counts on those tabs were worked out from whichever hundred rows the current page happened to
/// hold, so changing the sort changed them: the same restaurant, the same filters, 402 orders, and
/// "Active" read 14 newest-first and 26 oldest-first. A queue count that depends on the sort is not
/// a count of the queue, and on a kitchen screen it can read zero while there is work waiting.
/// </para>
/// <para>
/// Stated here so one definition serves both the counting and the filtering, over the whole filtered
/// set rather than a page of it.
/// </para>
/// </remarks>
public static class StaffOrderQueue
{
    /// <summary>Orders still moving through the kitchen.</summary>
    public static bool IsLive(OrderStatus status) =>
        status is OrderStatus.Pending or OrderStatus.Accepted or OrderStatus.Preparing or OrderStatus.Ready;

    public static bool IsClosed(OrderStatus status) =>
        status is OrderStatus.Completed or OrderStatus.Cancelled or OrderStatus.Rejected;

    /// <summary>
    /// Waiting on money, so the kitchen must not start. Mirrors the client's payment state: awaiting,
    /// failed, or refunded.
    /// </summary>
    public static bool IsPaymentHold(OrderStatus status, PaymentStatus paymentStatus, PaymentMethod paymentMethod)
    {
        if (!IsLive(status))
        {
            return false;
        }

        if (paymentStatus == PaymentStatus.Refunded)
        {
            return true;
        }

        if (OrderPaymentEligibility.IsSettledForFulfillment(paymentStatus))
        {
            return false;
        }

        // Counter orders are collected at the till, so an unpaid one is not holding the kitchen up.
        if (paymentMethod == PaymentMethod.PayAtCounter)
        {
            return false;
        }

        return true;
    }

    /// <summary>Still open a day later — someone has to decide what to do with it.</summary>
    public static bool IsCarriedOver(OrderStatus status, DateTime createdAt, DateTime utcNow) =>
        IsLive(status) && utcNow - createdAt >= TimeSpan.FromHours(24);

    /// <summary>How long an order may wait before the screen calls it late.</summary>
    public static readonly TimeSpan LateAfter = TimeSpan.FromMinutes(20);

    /// <summary>
    /// Whether an order belongs to a queue.
    /// </summary>
    /// <remarks>
    /// Payment holds and carried-over orders are taken out of the working queues deliberately: they
    /// need a decision rather than a pan, and leaving them in makes the kitchen's own numbers wrong.
    /// </remarks>
    public static bool Matches(
        string queue,
        OrderStatus status,
        PaymentStatus paymentStatus,
        PaymentMethod paymentMethod,
        DateTime createdAt,
        DateTime utcNow) =>
        Matches(
            queue,
            status,
            paymentStatus,
            paymentMethod,
            IsCarriedOver(status, createdAt, utcNow),
            utcNow - createdAt >= LateAfter);

    /// <summary>
    /// The same decision, taking age as the two facts it actually turns on.
    /// </summary>
    /// <remarks>
    /// Counting asks the database to group orders, which can answer "older than a day" and "waiting
    /// over twenty minutes" but cannot hand back every timestamp cheaply. Taking the two booleans lets
    /// the counting and the row filtering share this method rather than each restating the rules.
    /// </remarks>
    public static bool Matches(
        string queue,
        OrderStatus status,
        PaymentStatus paymentStatus,
        PaymentMethod paymentMethod,
        bool isOlderThanADay,
        bool isOverdue)
    {
        if (queue == "closed")
        {
            return IsClosed(status);
        }

        if (!IsLive(status))
        {
            return false;
        }

        var hold = IsPaymentHold(status, paymentStatus, paymentMethod);
        var carried = isOlderThanADay;

        return queue switch
        {
            "payment" => hold,
            "carried" => carried && !hold,
            "late" => !hold && !carried && isOverdue,
            "new" => !hold && !carried && status == OrderStatus.Pending,
            "kitchen" => !hold && !carried && status is OrderStatus.Accepted or OrderStatus.Preparing,
            "ready" => !hold && !carried && status == OrderStatus.Ready,
            "active" => !hold && !carried,
            _ => false,
        };
    }

    /// <summary>
    /// The same decision again, as something the database can run.
    /// </summary>
    /// <remarks>
    /// A queue's rows have to come from the whole set, not from a page of it — filtering a hundred
    /// fetched rows down to the active ones shows a fraction of the active orders and calls it the
    /// queue. This is a second statement of <see cref="Matches"/> and could drift from it, so a test
    /// runs both over every combination of status, payment state, method and age and requires them to
    /// agree.
    /// </remarks>
    public static Expression<Func<Order, bool>> Predicate(string queue, DateTime utcNow)
    {
        var dayOld = utcNow - TimeSpan.FromHours(24);
        var overdue = utcNow - LateAfter;

        if (queue == "closed")
        {
            return order => order.Status == OrderStatus.Completed
                || order.Status == OrderStatus.Cancelled
                || order.Status == OrderStatus.Rejected;
        }

        // Spelled out rather than calling the methods above: the database has to run this, and it
        // cannot call into C#. The pieces are in the same order as the method above so the two read
        // alike, and the drift test holds them to it.
        var live = new[]
        {
            OrderStatus.Pending, OrderStatus.Accepted, OrderStatus.Preparing, OrderStatus.Ready,
        };
        var settled = new[]
        {
            PaymentStatus.Paid, PaymentStatus.PartiallyRefunded, PaymentStatus.NotRequired,
        };

        return queue switch
        {
            "payment" => order => live.Contains(order.Status)
                && (order.PaymentStatus == PaymentStatus.Refunded
                    || (!settled.Contains(order.PaymentStatus) && order.PaymentMethod != PaymentMethod.PayAtCounter)),
            "carried" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt <= dayOld,
            "late" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt > dayOld
                && order.CreatedAt <= overdue,
            "new" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt > dayOld
                && order.Status == OrderStatus.Pending,
            "kitchen" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt > dayOld
                && (order.Status == OrderStatus.Accepted || order.Status == OrderStatus.Preparing),
            "ready" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt > dayOld
                && order.Status == OrderStatus.Ready,
            "active" => order => live.Contains(order.Status)
                && order.PaymentStatus != PaymentStatus.Refunded
                && (settled.Contains(order.PaymentStatus) || order.PaymentMethod == PaymentMethod.PayAtCounter)
                && order.CreatedAt > dayOld,
            _ => _ => false,
        };
    }

    /// <summary>
    /// Whether a name is one of the queues, so an unknown one can be refused rather than silently
    /// matching nothing and reporting an empty kitchen.
    /// </summary>
    public static bool IsKnown(string? queue) =>
        queue is not null && All.Contains(queue);

    /// <summary>Every queue the screen shows, so counting one cannot forget another.</summary>
    public static readonly IReadOnlyList<string> All =
        ["active", "new", "kitchen", "ready", "late", "payment", "carried", "closed"];

    /// <summary>
    /// How much work each queue holds, across everything <paramref name="query"/> matches.
    /// </summary>
    /// <remarks>
    /// Grouped in the database and classified here, so the counts use the same rules as the rows
    /// without pulling every order back to count it. The grouping keys are the only things the rules
    /// turn on, so a restaurant with a hundred thousand orders still comes back as a few dozen rows.
    /// Pass a query without <c>Include</c>s: fetching every order's items to count orders would read
    /// a whole restaurant's history to answer a number on a tab.
    /// </remarks>
    public static async Task<IReadOnlyDictionary<string, int>> CountAsync(
        IQueryable<Order> query,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var dayOld = utcNow.AddHours(-24);
        var overdue = utcNow - LateAfter;

        var groups = await query
            .GroupBy(order => new
            {
                order.Status,
                order.PaymentStatus,
                order.PaymentMethod,
                OlderThanADay = order.CreatedAt <= dayOld,
                Overdue = order.CreatedAt <= overdue,
            })
            .Select(group => new { group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var counts = All.ToDictionary(name => name, _ => 0);

        foreach (var group in groups)
        {
            foreach (var name in All)
            {
                if (Matches(
                        name,
                        group.Key.Status,
                        group.Key.PaymentStatus,
                        group.Key.PaymentMethod,
                        group.Key.OlderThanADay,
                        group.Key.Overdue))
                {
                    counts[name] += group.Count;
                }
            }
        }

        return counts;
    }
}
