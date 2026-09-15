using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Closes table sessions that nothing is happening on any more.
/// </summary>
/// <remarks>
/// <para>
/// A session used to close in exactly two places, both at the front counter: settling a table, and
/// completing the last order on one. Every other way an order can stop being live — a customer
/// cancelling, staff rejecting, an unpaid order timing out, a full refund calling it off — left the
/// session open with nothing on it. That is how a dining room with nobody in it came to report six
/// occupied tables, one of them occupied since the previous month.
/// </para>
/// <para>
/// A sweep rather than a line added to each of those six paths, because the list of ways an order
/// can end is not finished: the seventh will be written by somebody who has never heard of table
/// sessions, and a rule that has to be remembered in seven places is a rule that is already wrong
/// somewhere. Nothing here moves money or touches an order, so arriving a minute or two late costs
/// nothing — and the two counter paths still close their sessions on the spot, which is where
/// somebody is actually watching the screen.
/// </para>
/// </remarks>
public sealed class FinishedTableSessionSweep(
    IServiceScopeFactory scopeFactory,
    ILogger<FinishedTableSessionSweep> logger) : BackgroundService
{
    public static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(2);

    public const int BatchSize = 100;

    private static readonly OrderStatus[] LiveStatuses =
    [
        OrderStatus.Pending,
        OrderStatus.Accepted,
        OrderStatus.Preparing,
        OrderStatus.Ready,
    ];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(ScanInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await CloseBatchAsync(stoppingToken);
        }
    }

    /// <summary>One pass. Public so it can be run directly by a test rather than on a timer.</summary>
    /// <returns>How many sessions this pass closed.</returns>
    public async Task<int> CloseBatchAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var now = DateTime.UtcNow;

            var finished = await dbContext.TableSessions
                .Where(session =>
                    session.Status == TableSessionStatus.Open
                    // Something has to have happened on it. A session opened seconds ago by someone
                    // still reading the menu has no orders yet either, and closing that would take
                    // the cart out from under them mid-sentence.
                    && dbContext.Orders.Any(order => order.TableSessionId == session.Id)
                    && !dbContext.Orders.Any(order =>
                        order.TableSessionId == session.Id
                        && LiveStatuses.Contains(order.Status)))
                .OrderBy(session => session.OpenedAt)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            if (finished.Count == 0)
            {
                return 0;
            }

            foreach (var session in finished)
            {
                session.Status = TableSessionStatus.Closed;
                session.ClosedAt = now;
                session.UpdatedAt = now;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation("Closed {Count} finished table sessions.", finished.Count);
            return finished.Count;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Bookkeeping. A failed sweep means a table reads occupied for another two minutes, so
            // it is logged and retried rather than allowed to take the host down with it.
            logger.LogError(exception, "Closing finished table sessions failed.");
            return 0;
        }
    }
}
