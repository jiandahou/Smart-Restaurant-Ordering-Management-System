using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An outbox is two halves and both have to be plugged in: the callers must queue instead of
/// sending, and something must drain the table. Either half alone is worse than what it replaces —
/// a queue nobody drains loses the email silently and slowly instead of quickly.
/// </summary>
public sealed class EmailOutboxWiringTests
{
    [Fact]
    public void PaymentNotificationsAreQueuedRatherThanSentInline()
    {
        var source = Source("Services", "PaymentNotificationService.cs");

        Assert.Contains("outbox.EnqueueAsync", source, StringComparison.Ordinal);
        // The exact shape of the defect: a provider call inside the request, wrapped in a catch.
        Assert.DoesNotContain("emailSender.SendAsync", source, StringComparison.Ordinal);
    }

    [Fact]
    public void EveryNotificationCarriesAKeyForTheDecisionRatherThanTheAttempt()
    {
        // A fresh Guid per call would defeat the whole point: Stripe redelivers webhooks, and the
        // customer would get "your refund was approved" once per redelivery.
        var source = Source("Services", "PaymentNotificationService.cs");

        foreach (var key in new[] { "payment-receipt:", "refund-succeeded:", "refund-failed:", "refund-rejected:" })
        {
            Assert.Contains(key, source, StringComparison.Ordinal);
        }

        Assert.DoesNotContain("Guid.NewGuid()", source, StringComparison.Ordinal);
    }

    [Fact]
    public void SomethingDrainsTheTable()
    {
        Assert.Contains("AddHostedService<EmailOutboxWorker>()", Source("", "Program.cs"), StringComparison.Ordinal);
        Assert.Contains("AddScoped<TransactionalEmailOutbox>()", Source("", "Program.cs"), StringComparison.Ordinal);
    }

    [Fact]
    public void TwoInstancesDoNotBothSendTheSameEmail()
    {
        // The API runs more than one replica in anything but development, and a plain SELECT would
        // hand the same row to both.
        var source = Source("Services", "EmailOutboxWorker.cs");

        Assert.Contains("FOR UPDATE SKIP LOCKED", source, StringComparison.Ordinal);
        Assert.Contains("BeginTransactionAsync", source, StringComparison.Ordinal);
    }

    [Fact]
    public void GivingUpIsLoggedAtAnAlertableLevel()
    {
        // The failure this replaces was silent by construction. If the end state is another
        // LogWarning among thousands, nothing has changed.
        var source = Source("Services", "EmailOutboxWorker.cs");
        var giveUp = source.IndexOf("DeadLettered;", StringComparison.Ordinal);

        Assert.True(giveUp >= 0);
        Assert.Contains("logger.LogError", source[giveUp..], StringComparison.Ordinal);
    }

    [Fact]
    public void TheSweepSurvivesABadBatch()
    {
        // A worker that dies on one poisoned row is the silent failure all over again.
        var source = Source("Services", "EmailOutboxWorker.cs");
        var loop = source.IndexOf("WaitForNextTickAsync", StringComparison.Ordinal);

        Assert.True(loop >= 0);
        Assert.Contains("catch (Exception error)", source[loop..], StringComparison.Ordinal);
    }

    private static string Source(string folder, string file)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !System.IO.File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);

        var path = folder.Length == 0
            ? Path.Combine(directory!.FullName, "DineFlow.Api", file)
            : Path.Combine(directory!.FullName, "DineFlow.Api", folder, file);

        return System.IO.File.ReadAllText(path);
    }
}
