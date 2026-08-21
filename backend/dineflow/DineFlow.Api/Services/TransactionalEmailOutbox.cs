using DineFlow.Infrastructure.Messaging;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

/// <summary>
/// Writes an email down before trying to send it.
/// </summary>
/// <remarks>
/// <para>
/// A provider call inside a request is a promise the request cannot keep: the money has already
/// moved by the time the email is attempted, so a failure cannot be surfaced to the caller and was
/// swallowed into a log line. Recording the decision first turns "we tried and something happened"
/// into a row somebody can look at, retry, and be alerted about.
/// </para>
/// <para>
/// Enqueuing does not save. It joins whatever transaction the caller is already in, so an email is
/// queued if and only if the thing it describes actually happened — no notice about a refund that
/// rolled back, and no refund that silently notified nobody.
/// </para>
/// </remarks>
public sealed class TransactionalEmailOutbox(AppDbContext dbContext, ILogger<TransactionalEmailOutbox> logger)
{
    /// <summary>
    /// Queues one email, or does nothing if this exact decision was already queued.
    /// </summary>
    /// <param name="idempotencyKey">
    /// Identifies the decision, not the attempt — "refund-approved:{orderId}", not a new Guid.
    /// </param>
    /// <returns>True when a new email was queued.</returns>
    public async Task<bool> EnqueueAsync(
        string idempotencyKey,
        string category,
        string recipient,
        string subject,
        string htmlBody,
        string? textBody,
        Guid? orderId = null,
        Guid? restaurantId = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(recipient))
        {
            logger.LogWarning("Refusing to queue {Category} email with no recipient ({Key}).", category, idempotencyKey);
            return false;
        }

        var key = Truncate(idempotencyKey, 200);

        // Checked as well as constrained. The unique index is the guarantee; this keeps the ordinary
        // duplicate from turning the caller's whole transaction into a failed insert.
        if (await dbContext.OutboxEmails.AnyAsync(email => email.IdempotencyKey == key, cancellationToken))
        {
            return false;
        }

        var now = DateTime.UtcNow;

        await dbContext.OutboxEmails.AddAsync(new OutboxEmail
        {
            Id = Guid.NewGuid(),
            IdempotencyKey = key,
            Category = Truncate(category, 64),
            Recipient = Truncate(recipient.Trim(), 320),
            Subject = Truncate(subject, 300),
            HtmlBody = htmlBody,
            TextBody = textBody,
            Status = OutboxEmailStatus.Pending,
            AttemptCount = 0,
            // Due immediately: the worker picks it up on its next tick rather than waiting out a delay
            // nobody asked for.
            NextAttemptAt = now,
            CreatedAt = now,
            OrderId = orderId,
            RestaurantId = restaurantId,
        }, cancellationToken);

        return true;
    }

    private static string Truncate(string value, int length) =>
        value.Length <= length ? value : value[..length];
}
