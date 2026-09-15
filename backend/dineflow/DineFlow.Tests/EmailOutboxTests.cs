using DineFlow.Api.Services;
using DineFlow.Infrastructure.Messaging;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The email used to exist only for the duration of one provider call. A failure was caught, logged
/// and forgotten, so a provider outage meant a morning of refund notices that were never sent and
/// never missed. These cover the two halves of the replacement: the decision is written down, and
/// something drains it.
/// </summary>
public sealed class EmailOutboxTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();

    public Task InitializeAsync() => _database.InitializeAsync();

    public Task DisposeAsync() => _database.DisposeAsync();

    private static TransactionalEmailOutbox OutboxFor(AppDbContext dbContext) =>
        new(dbContext, NullLogger<TransactionalEmailOutbox>.Instance);

    private static async Task<bool> QueueAsync(
        AppDbContext dbContext,
        string key = "refund-succeeded:1",
        string recipient = "diner@example.com")
    {
        var queued = await OutboxFor(dbContext).EnqueueAsync(
            key, "payment", recipient, "Refund issued", "<p>ok</p>", "ok");

        await dbContext.SaveChangesAsync();
        return queued;
    }

    [RequiresPostgresFact]
    public async Task ADecisionToNotifyIsWrittenDownBeforeAnythingIsSent()
    {
        await using var dbContext = _database.CreateContext();

        Assert.True(await QueueAsync(dbContext));

        var email = await dbContext.OutboxEmails.SingleAsync();

        Assert.Equal(OutboxEmailStatus.Pending, email.Status);
        Assert.Equal(0, email.AttemptCount);
        Assert.NotNull(email.NextAttemptAt);
    }

    [RequiresPostgresFact]
    public async Task TheSameDecisionIsNotQueuedTwice()
    {
        // Stripe redelivers webhooks and people press buttons twice. Four copies of "your refund
        // was approved" is not a system working correctly.
        await using var dbContext = _database.CreateContext();

        Assert.True(await QueueAsync(dbContext));
        Assert.False(await QueueAsync(dbContext));
        Assert.Equal(1, await dbContext.OutboxEmails.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task ADifferentDecisionIsQueuedSeparately()
    {
        await using var dbContext = _database.CreateContext();

        await QueueAsync(dbContext, "refund-succeeded:1");
        await QueueAsync(dbContext, "refund-succeeded:2");

        Assert.Equal(2, await dbContext.OutboxEmails.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task AnEmailWithNowhereToGoIsNotQueued()
    {
        await using var dbContext = _database.CreateContext();

        Assert.False(await QueueAsync(dbContext, recipient: "   "));
        Assert.Equal(0, await dbContext.OutboxEmails.CountAsync());
    }

    [RequiresPostgresFact]
    public async Task TheWorkerSendsWhatIsWaitingAndRecordsThatItDid()
    {
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        var sender = new RecordingSender();
        await WorkerFor(sender).DeliverBatchAsync(CancellationToken.None);

        await using var reread = _database.CreateContext();
        var email = await reread.OutboxEmails.SingleAsync();

        Assert.Single(sender.Sent);
        Assert.Equal(OutboxEmailStatus.Sent, email.Status);
        Assert.NotNull(email.SentAt);
        Assert.Null(email.NextAttemptAt);
    }

    [RequiresPostgresFact]
    public async Task AFailureIsKeptAndTriedAgainLater()
    {
        // The whole defect in one assertion: the email survives the failure.
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        await WorkerFor(new RecordingSender { Failure = new InvalidOperationException("503 Service Unavailable") })
            .DeliverBatchAsync(CancellationToken.None);

        await using var reread = _database.CreateContext();
        var email = await reread.OutboxEmails.SingleAsync();

        Assert.Equal(OutboxEmailStatus.Pending, email.Status);
        Assert.Equal(1, email.AttemptCount);
        Assert.True(email.NextAttemptAt > DateTime.UtcNow);
        Assert.Contains("503", email.LastError!, StringComparison.Ordinal);
    }

    [RequiresPostgresFact]
    public async Task AnEmailNotYetDueIsLeftAlone()
    {
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        var email = await dbContext.OutboxEmails.SingleAsync();
        email.NextAttemptAt = DateTime.UtcNow.AddHours(1);
        await dbContext.SaveChangesAsync();

        var sender = new RecordingSender();
        await WorkerFor(sender).DeliverBatchAsync(CancellationToken.None);

        Assert.Empty(sender.Sent);
    }

    [RequiresPostgresFact]
    public async Task ARejectedAddressIsGivenUpOnAtOnce()
    {
        // Retrying a hard bounce burns the sending reputation every other email depends on.
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        await WorkerFor(new RecordingSender { Failure = new InvalidOperationException("Invalid email address") })
            .DeliverBatchAsync(CancellationToken.None);

        await using var reread = _database.CreateContext();
        var email = await reread.OutboxEmails.SingleAsync();

        Assert.Equal(OutboxEmailStatus.DeadLettered, email.Status);
        Assert.Equal(1, email.AttemptCount);
        Assert.Null(email.NextAttemptAt);
    }

    [RequiresPostgresFact]
    public async Task TheBudgetRunsOutAndTheRowBecomesSomethingAPersonCanSee()
    {
        // An unbounded retry is how a broken address turns into permanent load nobody notices.
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        var worker = WorkerFor(new RecordingSender { Failure = new InvalidOperationException("timed out") });

        for (var attempt = 0; attempt < EmailDeliveryPolicy.MaximumAttempts; attempt += 1)
        {
            await using var due = _database.CreateContext();
            var pending = await due.OutboxEmails.SingleAsync();
            pending.NextAttemptAt = DateTime.UtcNow.AddSeconds(-1);
            await due.SaveChangesAsync();

            await worker.DeliverBatchAsync(CancellationToken.None);
        }

        await using var reread = _database.CreateContext();
        var email = await reread.OutboxEmails.SingleAsync();

        Assert.Equal(OutboxEmailStatus.DeadLettered, email.Status);
        Assert.Equal(EmailDeliveryPolicy.MaximumAttempts, email.AttemptCount);
    }

    [RequiresPostgresFact]
    public async Task WhatWasQueuedIsWhatGoesOut()
    {
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        var sender = new RecordingSender();
        await WorkerFor(sender).DeliverBatchAsync(CancellationToken.None);

        var (to, subject, html, text) = Assert.Single(sender.Sent);

        Assert.Equal("diner@example.com", to);
        Assert.Equal("Refund issued", subject);
        Assert.Equal("<p>ok</p>", html);
        Assert.Equal("ok", text);
    }

    [RequiresPostgresFact]
    public async Task ASentEmailIsNotSentAgainOnTheNextSweep()
    {
        await using var dbContext = _database.CreateContext();
        await QueueAsync(dbContext);

        var sender = new RecordingSender();
        var worker = WorkerFor(sender);

        await worker.DeliverBatchAsync(CancellationToken.None);
        await worker.DeliverBatchAsync(CancellationToken.None);

        Assert.Single(sender.Sent);
    }

    private EmailOutboxWorker WorkerFor(IEmailSender sender)
    {
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseNpgsql(_database.ConnectionString));
        services.AddSingleton(sender);

        return new EmailOutboxWorker(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            NullLogger<EmailOutboxWorker>.Instance);
    }

    private sealed class RecordingSender : IEmailSender
    {
        public Exception? Failure { get; init; }

        public List<(string To, string Subject, string Html, string Text)> Sent { get; } = [];

        public Task SendAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken cancellationToken = default)
        {
            if (Failure is not null)
            {
                throw Failure;
            }

            Sent.Add((to, subject, htmlBody, textBody ?? string.Empty));
            return Task.CompletedTask;
        }
    }
}
