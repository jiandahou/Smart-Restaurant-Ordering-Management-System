using System.Text.Encodings.Web;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <summary>
/// Customer-facing transactional mail for payments: the Stripe receipt and the outcome of a refund.
/// Every send is best-effort — a mail failure must never roll back money that already moved, so
/// failures are logged and swallowed rather than propagated to the caller.
/// </summary>
public sealed class PaymentNotificationService(
    IEmailSender emailSender,
    ILogger<PaymentNotificationService> logger)
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

        var orderNumber = HtmlEncoder.Default.Encode(order.OrderNumber);
        var url = HtmlEncoder.Default.Encode(payment.ProviderReceiptUrl);
        var amount = FormatAmount(payment.AmountCents, payment.Currency);

        await SendSafelyAsync(
            recipient,
            $"Your receipt for {order.OrderNumber}",
            $"""
            <p>Here is your receipt for order {orderNumber}.</p>
            <p>Amount paid: <strong>{amount}</strong></p>
            <p><a href="{url}">View your receipt</a></p>
            """,
            $"Your receipt for {order.OrderNumber} ({amount}): {payment.ProviderReceiptUrl}",
            cancellationToken);

        return true;
    }

    public Task SendRefundSucceededAsync(
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

        var orderNumber = HtmlEncoder.Default.Encode(order.OrderNumber);
        var refunded = FormatAmount(refund.AmountCents, refund.Currency);
        // A partial refund has to say so, or the customer expects the full order value back.
        var isPartial = refund.AmountCents < payment.AmountCents;
        var context = isPartial
            ? $"<p>This is a partial refund of your {FormatAmount(payment.AmountCents, payment.Currency)} order.</p>"
            : string.Empty;

        return SendSafelyAsync(
            recipient,
            $"Refund issued for {order.OrderNumber}",
            $"""
            <p>We have refunded <strong>{refunded}</strong> for order {orderNumber}.</p>
            {context}
            <p>It can take a few business days to appear on your statement, depending on your bank.</p>
            """,
            $"We have refunded {refunded} for order {order.OrderNumber}. It can take a few business days to appear on your statement.",
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

        var orderNumber = HtmlEncoder.Default.Encode(order.OrderNumber);
        var attempted = FormatAmount(refund.AmountCents, refund.Currency);

        return SendSafelyAsync(
            recipient,
            $"We could not complete your refund for {order.OrderNumber}",
            $"""
            <p>We tried to refund <strong>{attempted}</strong> for order {orderNumber}, but it did not go through.</p>
            <p>No money has left our account. Please contact the restaurant so we can sort this out for you.</p>
            """,
            $"We tried to refund {attempted} for order {order.OrderNumber} but it did not go through. Please contact the restaurant.",
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

        var orderNumber = HtmlEncoder.Default.Encode(order.OrderNumber);
        var reason = string.IsNullOrWhiteSpace(adminNote)
            ? string.Empty
            : $"<p>The restaurant said: {HtmlEncoder.Default.Encode(adminNote)}</p>";

        return SendSafelyAsync(
            recipient,
            $"Update on your refund request for {order.OrderNumber}",
            $"""
            <p>Your refund request for order {orderNumber} was not approved.</p>
            {reason}
            <p>If you think this is a mistake, please reply to the restaurant directly.</p>
            """,
            $"Your refund request for order {order.OrderNumber} was not approved."
                + (string.IsNullOrWhiteSpace(adminNote) ? string.Empty : $" The restaurant said: {adminNote}"),
            cancellationToken);
    }

    private async Task SendSafelyAsync(
        string recipient,
        string subject,
        string htmlBody,
        string textBody,
        CancellationToken cancellationToken)
    {
        try
        {
            await emailSender.SendAsync(recipient, subject, htmlBody, textBody, cancellationToken);
        }
        catch (Exception ex)
        {
            // Money has already moved by the time we get here; a bounced email must not undo it.
            logger.LogError(ex, "Failed to send payment notification \"{Subject}\".", subject);
        }
    }

    private static string FormatAmount(long amountCents, string currency) =>
        (amountCents / 100m).ToString("0.00") + " " + (currency ?? "aud").ToUpperInvariant();
}
