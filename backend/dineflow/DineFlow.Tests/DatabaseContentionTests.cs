using DineFlow.Infrastructure.Persistence;
using Npgsql;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Telling a busy moment apart from a broken one.
/// </summary>
/// <remarks>
/// Everyone ordering the last of the popular dish queues on its row, which is exactly what stops it
/// overselling. What was wrong was the answer when the queue grew: the wait ran into the driver's
/// thirty second command timeout and came back as an unhandled failure, so somebody who had watched
/// a spinner for half a minute was told "an unexpected error occurred" — and not whether they had
/// been charged.
/// </remarks>
public class DatabaseContentionTests
{
    private static PostgresException LockNotAvailable() =>
        new("canceling statement due to lock timeout", "ERROR", "ERROR", "55P03");

    private static PostgresException SomethingElse() =>
        new("duplicate key value violates unique constraint", "ERROR", "ERROR", "23505");

    [Fact]
    public void ItRecognisesAWaitThatWasGivenUpOn() =>
        Assert.True(DatabaseContention.IsLockWaitTimeout(LockNotAvailable()));

    /// <summary>
    /// Buried, because the driver and EF each wrap it on the way up, and the handler sees the
    /// outermost one.
    /// </summary>
    [Fact]
    public void ItFindsItUnderneathWhateverWrappedIt()
    {
        var wrapped = new InvalidOperationException(
            "An exception has been raised that is likely due to a transient failure.",
            new Exception("execution strategy", LockNotAvailable()));

        Assert.True(DatabaseContention.IsLockWaitTimeout(wrapped));
    }

    /// <summary>
    /// A real fault must keep reading as a fault. Answering every database error with "we are busy,
    /// try again" would hide the ones that never get better and teach everyone to retry them.
    /// </summary>
    [Fact]
    public void ItDoesNotCallEveryDatabaseFailureContention()
    {
        Assert.False(DatabaseContention.IsLockWaitTimeout(SomethingElse()));
        Assert.False(DatabaseContention.IsLockWaitTimeout(new TimeoutException("Timeout during reading attempt")));
        Assert.False(DatabaseContention.IsLockWaitTimeout(new InvalidOperationException("nope")));
        Assert.False(DatabaseContention.IsLockWaitTimeout(null));
    }

    /// <summary>
    /// The sentence exists to answer one question, and a checkout is where it gets asked.
    /// </summary>
    [Fact]
    public void ItSaysWhetherTheCustomerHasBeenCharged()
    {
        Assert.Contains("Nothing has been charged", DatabaseContention.CustomerExplanation, StringComparison.Ordinal);
        Assert.DoesNotContain("55P03", DatabaseContention.CustomerExplanation, StringComparison.Ordinal);
        Assert.DoesNotContain("lock", DatabaseContention.CustomerExplanation, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Long enough not to refuse orders that were about to go through — a soak at eight concurrent
    /// checkouts of one dish settled between four and seven and a half seconds, all succeeding —
    /// and far short of the thirty the driver would otherwise spend.
    /// </summary>
    [Fact]
    public void ItWaitsLongerThanABusyServiceButNotLongerThanAPerson()
    {
        Assert.InRange(DatabaseContention.LockWait, TimeSpan.FromSeconds(8), TimeSpan.FromSeconds(15));
    }
}
