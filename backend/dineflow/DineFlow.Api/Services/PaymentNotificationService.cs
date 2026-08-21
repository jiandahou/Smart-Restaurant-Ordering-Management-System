using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <summary>
/// Customer-facing transactional mail for payments: the Stripe receipt and the outcome of a refund.
/// </summary>
/// <remarks>
/// <para>
/// A mail failure must never roll back money that already moved, and for a long time that reasoning
/// stopped one step early: the provider was called inline, the exception was caught, a line went to
/// the log, and the email was gone. No retry, no record, and no way to answer "was the customer told
/// their refund was approved?" other than asking them.
/// </para>
/// <para>
/// Queued instead. The row is written in the caller's own transaction — so the notice exists exactly
/// when the thing it describes does — and <see cref="EmailOutboxWorker"/> does the sending, with a
/// retry schedule and a dead-letter state somebody can be alerted on.
/// </para>
/// </remarks>
public sealed class PaymentNotificationService(
    TransactionalEmailOutbox outbox,
    ILogger<PaymentNotificationService> logger,
    TransactionalEmailLayout emailLayout)
{
    /// Registered customers are the best address; guest checkouts only ever exist on the charge.
    public static string? ResolveRecipient(Order? order, Payment? payment, string? requesterEmail = null)
    {
        if (!string.IsNullOrWhiteSpace(requesterEmail))
        {
            return requesterEmail.Trim();
        }

        if (!string.IsNullOrWhiteSpace(order?.Customer?.Email))
        {
            return order.Customer.Email.Trim();
        }

        return string.IsNullOrWhiteSpace(payment?.ReceiptEmail) ? null : payment.ReceiptEmail.Trim();
    }

    public async Task<bool> SendReceiptAsync(
        Order order,
        Payment payment,
        CancellationToken cancellationToken)
    {
        var recipient = ResolveRecipient(order, payment);
        if (string.IsNullOrWhiteSpace(recipient) || string.IsNullOrWhiteSpace(payment.ProviderReceiptUrl))
        {
            return false;
        }

        var amount = FormatAmount(payment.AmountCents, payment.Currency);

        await QueueAsync(
            $"payment-receipt:{payment.Id}",
            order,
            recipient,
            $"Your receipt for {order.OrderNumber}",
            new TransactionalEmail(
                Heading: "Your receipt",
                Paragraphs:
                [
                    $"Here is your receipt for order {order.OrderNumber}.",
                    $"Amount paid: {amount}"
                ],
                ActionLabel: "View your receipt",
                ActionUrl: payment.ProviderReceiptUrl),
            cancellationToken);

        return true;
    }

    /// <param name="customerExplanation">
    /// Why the refund happened, in words meant for the customer. Only supplied by automated paths
    /// that know the cause — a staff refund reason is an internal note and must not be forwarded.
    /// Without it a refund the customer did not ask for arrives with no explanation at all.
    /// </param>
    public Task SendRefundSucceededAsync(
        Order order,
        Payment payment,
        PaymentRefund refund,
        string? requesterEmail,
        CancellationToken cancellationToken,
        string? customerExplanation = null)
    {
        var recipient = ResolveRecipient(order, payment, requesterEmail);
        if (string.IsNullOrWhiteSpace(recipient))
        {
            return Task.CompletedTask;
        }

        var refunded = FormatAmount(refund.AmountCents, refund.Currency);
        var paragraphs = new List<string> { $"We have refunded {refunded} for order {order.OrderNumber}." };

        if (!string.IsNullOrWhiteSpace(customerExplanation))
        {
            paragraphs.Add(customerExplanation.Trim());
        }

        // A partial refund has to say so, or the customer expects the full order value back.
        if (refund.AmountCents < payment.AmountCents)
        {
            paragraphs.Add(
                $"This is a partial refund of your {FormatAmount(payment.AmountCents, payment.Currency)} order.");
        }

        return QueueAsync(
            $"refund-succeeded:{refund.Id}",
            order,
            recipient,
            $"Refund issued for {order.OrderNumber}",
            new TransactionalEmail(
                Heading: "Refund issued",
                Paragraphs: paragraphs,
                Footnotes: ["It can take a few business days to appear on your statement, depending on your bank."]),
            cancellationToken);
    }

    public Task SendRefundFailedAsync(
        Order order,
        Payment payment,
        PaymentRefund refund,
        string? requesterEmail,
        CancellationToken cancellationToken)
    {
        var recipient = ResolveRecipient(order, payment, requesterEmail);
        if (string.IsNullOrWhiteSpace(recipient))
        {
            return Task.CompletedTask;
        }

        var attempted = FormatAmount(refund.AmountCents, refund.Currency);

        return QueueAsync(
            $"refund-failed:{refund.Id}",
            order,
            recipient,
            $"We could not complete your refund for {order.OrderNumber}",
            new TransactionalEmail(
                Heading: "We could not complete your refund",
                Paragraphs:
                [
                    $"We tried to refund {attempted} for order {order.OrderNumber}, but it did not go through.",
                    "No money has left our account. Please contact the restaurant so we can sort this out for you."
                ]),
            cancellationToken);
    }

    public Task SendRefundRejectedAsync(
        Order order,
        Payment? payment,
        string? requesterEmail,
        string? adminNote,
        CancellationToken cancellationToken)
    {
        var recipient = ResolveRecipient(order, payment, requesterEmail);
        if (string.IsNullOrWhiteSpace(recipient))
        {
            return Task.CompletedTask;
        }

        var paragraphs = new List<string> { $"Your refund request for order {order.OrderNumber} was not approved." };

        if (!string.IsNullOrWhiteSpace(adminNote))
        {
            paragraphs.Add($"The restaurant said: {adminNote.Trim()}");
        }

        return QueueAsync(
            // Keyed on the payment when there is one, so a second rejection on a re-opened request
            // is a different decision and still reaches the customer.
            $"refund-rejected:{order.Id}:{payment?.Id.ToString() ?? "none"}",
            order,
            recipient,
            $"Update on your refund request for {order.OrderNumber}",
            new TransactionalEmail(
                Heading: "Update on your refund request",
                Paragraphs: paragraphs,
                Footnotes: ["If you think this is a mistake, please reply to the restaurant directly."]),
            cancellationToken);
    }

    /// <summary>
    /// Queues one notification. The key names the decision, not the attempt, so a redelivered
    /// webhook or a double-pressed button does not send the customer the same notice twice.
    /// </summary>
    private async Task QueueAsync(
        string idempotencyKey,
        Order order,
        string recipient,
        string subject,
        TransactionalEmail email,
        CancellationToken cancellationToken)
    {
        try
        {
            await outbox.EnqueueAsync(
                idempotencyKey,
                "payment",
                recipient,
                subject,
                emailLayout.RenderHtml(email),
                emailLayout.RenderText(email),
                order.Id,
                order.RestaurantId,
                cancellationToken);
        }
        catch (Exception ex)
        {
            // Money has already moved by the time we get here; a failure to queue must not undo it.
            // Unlike the send this replaces, reaching here means the database is unavailable, which
            // is not a condition a retry inside this method would survive either.
            logger.LogError(ex, "Failed to queue payment notification \"{Subject}\".", subject);
        }
    }

    private static string FormatAmount(long amountCents, string currency) =>
        (amountCents / 100m).ToString("0.00") + " " + (currency ?? "aud").ToUpperInvariant();
}
