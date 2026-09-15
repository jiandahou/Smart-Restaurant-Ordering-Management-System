using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Npgsql;

namespace DineFlow.Infrastructure.Persistence;

/// <summary>
/// Telling "the database is busy" apart from "the request was wrong".
/// </summary>
/// <remarks>
/// <para>
/// A row that everyone wants at once — the last portion of the day's popular dish — serialises the
/// checkouts that want it, which is what stops it overselling and is therefore correct. What was
/// not correct is what happened when the queue grew: the wait ran into the driver's thirty second
/// command timeout and came back as an unhandled failure, so a diner who had been staring at a
/// spinner for half a minute was finally told "an unexpected error occurred". Nothing about it was
/// unexpected, and the one thing they needed to know — whether they had just been charged — went
/// unsaid.
/// </para>
/// <para>
/// PostgreSQL will say so itself if asked: a statement-scoped <c>lock_timeout</c> gives up waiting
/// and raises <c>55P03</c>, which is a fact about the moment rather than about the request, and can
/// be answered honestly.
/// </para>
/// </remarks>
public static class DatabaseContention
{
    /// <summary>
    /// How long a request may wait for a contended row before it is told the kitchen is busy.
    /// </summary>
    /// <remarks>
    /// Above the band a busy service actually produces — a soak at eight concurrent checkouts of
    /// one dish settled between four and seven and a half seconds, all of them succeeding — and far
    /// below the thirty seconds the driver would otherwise spend before failing. Cutting it finer
    /// would start refusing orders that were about to go through, which is a worse trade than
    /// waiting a few seconds longer.
    /// </remarks>
    public static readonly TimeSpan LockWait = TimeSpan.FromSeconds(10);

    /// <summary>PostgreSQL's code for "I stopped waiting for a lock".</summary>
    private const string LockNotAvailable = "55P03";

    /// <summary>Whether this failure is contention rather than a fault.</summary>
    public static bool IsLockWaitTimeout(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException postgres && postgres.SqlState == LockNotAvailable)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Bounds how long <em>this transaction</em> will wait for a row somebody else is holding.
    /// </summary>
    /// <remarks>
    /// <c>SET LOCAL</c> so it dies with the transaction rather than riding a pooled connection into
    /// whatever runs next — a background sweep that can happily wait a minute should not inherit a
    /// diner's patience. Skipped for providers that have never heard of it, so the in-memory tests
    /// keep working.
    /// </remarks>
    public static async Task LimitLockWaitAsync(
        DatabaseFacade database,
        CancellationToken cancellationToken)
    {
        if (!database.IsNpgsql() || database.CurrentTransaction is null)
        {
            return;
        }

        // SET LOCAL takes no parameters, so the value has to be in the text. It is an integer
        // derived from a constant in this file and never touches a request, which is the only
        // reason writing SQL this way is acceptable here.
        var statement = "SET LOCAL lock_timeout = '"
            + ((int)LockWait.TotalMilliseconds).ToString(CultureInfo.InvariantCulture)
            + "ms'";

        await database.ExecuteSqlRawAsync(statement, cancellationToken);
    }

    /// <summary>What to tell whoever was waiting.</summary>
    /// <remarks>
    /// The last sentence is the point of the whole message. Somebody who has just watched a
    /// checkout fail wants to know whether to reach for their phone or their wallet, and a service
    /// that leaves that unanswered gets a second attempt at paying for the same dinner.
    /// </remarks>
    public const string CustomerExplanation =
        "The kitchen is taking a lot of orders at once. Nothing has been charged — try again in a moment.";
}
