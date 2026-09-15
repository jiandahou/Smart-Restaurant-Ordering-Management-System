using DineFlow.Infrastructure.Messaging;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Delivers whatever is waiting in the outbox, and gives up loudly rather than quietly.
/// </summary>
/// <remarks>
/// <para>
/// The failure this replaces was silent by construction: send inline, catch, log, carry on. Nobody
/// was watching the log, so a provider outage meant a morning of refund notices that were never
/// sent and never missed. Here a failure stays a row — visible, counted, retried on a schedule, and
/// eventually dead-lettered with an error loud enough to alert on.
/// </para>
/// <para>
/// Rows are claimed with a row lock, so two instances of the API do not both send the same email.
/// </para>
/// </remarks>
public sealed class EmailOutboxWorker(
    IServiceScopeFactory scopeFactory,
    ILogger<EmailOutboxWorker> logger) : BackgroundService
{
    /// <summary>Frequent enough that an ordinary email goes out promptly, cheap enough to idle.</summary>
    public static readonly TimeSpan ScanInterval = TimeSpan.FromSeconds(20);

    public const int BatchSize = 20;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(ScanInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await DeliverBatchAsync(stoppingToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                // The loop must survive anything one batch can do to it; a worker that dies on a
                // bad row is the silent failure this whole service exists to remove.
                logger.LogError(error, "The email outbox sweep failed.");
            }
        }
    }

    /// <summary>
    /// One sweep. Public so the delivery, the retry and the giving-up can be exercised directly;
    /// a background loop nothing can drive is a background loop nothing can test.
    /// </summary>
    public async Task DeliverBatchAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var emailSender = scope.ServiceProvider.GetRequiredService<IEmailSender>();
        var now = DateTime.UtcNow;

        var due = await dbContext.OutboxEmails
            .Where(email => email.Status == OutboxEmailStatus.Pending && email.NextAttemptAt <= now)
            .OrderBy(email => email.NextAttemptAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);

        foreach (var email in due)
        {
            await DeliverAsync(dbContext, emailSender, email, cancellationToken);
        }
    }

    private async Task DeliverAsync(
        AppDbContext dbContext,
        IEmailSender emailSender,
        OutboxEmail email,
        CancellationToken cancellationToken)
    {
        // Claimed under a lock so a second instance skips it rather than sending it again.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        var claimed = await dbContext.OutboxEmails
            .FromSql($"SELECT * FROM \"OutboxEmails\" WHERE \"Id\" = {email.Id} AND \"Status\" = 0 FOR UPDATE SKIP LOCKED")
            .FirstOrDefaultAsync(cancellationToken);

        if (claimed is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return;
        }

        var now = DateTime.UtcNow;
        claimed.AttemptCount += 1;
        claimed.UpdatedAt = now;

        try
        {
            await emailSender.SendAsync(
                claimed.Recipient,
                claimed.Subject,
                claimed.HtmlBody,
                claimed.TextBody,
                cancellationToken);

            claimed.Status = OutboxEmailStatus.Sent;
            claimed.SentAt = now;
            claimed.NextAttemptAt = null;
            claimed.LastError = null;
        }
        catch (Exception error)
        {
            claimed.LastError = Truncate(error.Message, 2000);

            var permanent = EmailDeliveryPolicy.IsPermanentFailure(error.Message);
            var nextAttempt = permanent ? null : EmailDeliveryPolicy.NextAttemptAt(claimed.AttemptCount, now);

            if (nextAttempt is null)
            {
                claimed.Status = OutboxEmailStatus.DeadLettered;
                claimed.NextAttemptAt = null;

                // The alert. Distinct from the per-attempt warnings on purpose: this is the point at
                // which a person has to do something, and it is the only line worth paging on.
                logger.LogError(
                    error,
                    "Giving up on {Category} email to {Recipient} after {Attempts} attempts ({Reason}). Outbox row {OutboxId} needs a human.",
                    claimed.Category,
                    claimed.Recipient,
                    claimed.AttemptCount,
                    permanent ? "the address was rejected" : "the retry budget ran out",
                    claimed.Id);
            }
            else
            {
                claimed.NextAttemptAt = nextAttempt;
                logger.LogWarning(
                    error,
                    "Attempt {Attempt} to send {Category} email to {Recipient} failed; retrying at {NextAttempt:o}.",
                    claimed.AttemptCount,
                    claimed.Category,
                    claimed.Recipient,
                    nextAttempt);
            }
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static string Truncate(string value, int length) =>
        value.Length <= length ? value : value[..length];
}
