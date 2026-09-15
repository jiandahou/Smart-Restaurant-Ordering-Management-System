using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Messaging;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The payment emails are the ones carrying money, and they were the last still hand-rolled as bare
/// paragraph tags. These cover what a recipient actually depends on: who sent it, and the facts the
/// old markup assembled by string concatenation.
/// </summary>
public sealed class PaymentNotificationContentTests
{
    /// <summary>
    /// Reads the queued row rather than a send that never happens here any more: the service writes
    /// the email to the outbox, and a worker delivers it. The content assertions are unchanged —
    /// what a recipient depends on is the same wherever it is captured.
    /// </summary>
    private sealed class QueuedEmail(AppDbContext dbContext)
    {
        private OutboxEmail Row => dbContext.ChangeTracker.Entries<OutboxEmail>()
            .Select(entry => entry.Entity)
            .Single();

        public string Html => Row.HtmlBody;
        public string Text => Row.TextBody ?? string.Empty;
        public string Subject => Row.Subject;
        public string Recipient => Row.Recipient;
        public string IdempotencyKey => Row.IdempotencyKey;
        public int Count => dbContext.ChangeTracker.Entries<OutboxEmail>().Count();
    }

    private static (PaymentNotificationService Service, QueuedEmail Sender) CreateService()
    {
        var dbContext = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"notifications-{Guid.NewGuid()}")
            .Options);
        var outbox = new TransactionalEmailOutbox(dbContext, NullLogger<TransactionalEmailOutbox>.Instance);
        var layout = new TransactionalEmailLayout(Options.Create(new ComplianceOptions
        {
            OperatorName = "DineFlow Pty Ltd",
            OperatorAbn = "51824753556",
        }));

        return (
            new PaymentNotificationService(outbox, NullLogger<PaymentNotificationService>.Instance, layout),
            new QueuedEmail(dbContext));
    }

    private static Order Order() => new()
    {
        OrderNumber = "DF-1042",
        Customer = new() { Email = "diner@example.com" },
    };

    private static Payment Payment(long cents = 4_500) => new() { AmountCents = cents, Currency = "aud" };

    [Fact]
    public async Task TheReceiptCarriesTheAmountTheLinkAndTheSenderIdentity()
    {
        var (service, sender) = CreateService();
        var payment = Payment();
        payment.ProviderReceiptUrl = "https://pay.stripe.com/receipts/abc123";

        var sent = await service.SendReceiptAsync(Order(), payment, CancellationToken.None);

        Assert.True(sent);
        Assert.Contains("45.00 AUD", sender.Html, StringComparison.Ordinal);
        Assert.Contains("https://pay.stripe.com/receipts/abc123", sender.Html, StringComparison.Ordinal);
        Assert.Contains("ABN 51824753556", sender.Html, StringComparison.Ordinal);
        // A receipt that only exists as HTML is the one a plain-text client cannot show at all.
        Assert.Contains("https://pay.stripe.com/receipts/abc123", sender.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task APartialRefundSaysSo()
    {
        // Without this line the customer expects the whole order value back.
        var (service, sender) = CreateService();
        var refund = new PaymentRefund { AmountCents = 1_500, Currency = "aud" };

        await service.SendRefundSucceededAsync(Order(), Payment(), refund, null, CancellationToken.None);

        Assert.Contains("15.00 AUD", sender.Html, StringComparison.Ordinal);
        Assert.Contains("partial refund of your 45.00 AUD order", sender.Html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AFullRefundDoesNotClaimToBePartial()
    {
        var (service, sender) = CreateService();
        var refund = new PaymentRefund { AmountCents = 4_500, Currency = "aud" };

        await service.SendRefundSucceededAsync(Order(), Payment(), refund, null, CancellationToken.None);

        Assert.DoesNotContain("partial", sender.Html, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AnUnrequestedRefundExplainsItself()
    {
        // A refund nobody asked for, with no reason given, reads as a mistake or a scam.
        var (service, sender) = CreateService();
        var refund = new PaymentRefund { AmountCents = 4_500, Currency = "aud" };

        await service.SendRefundSucceededAsync(
            Order(),
            Payment(),
            refund,
            null,
            CancellationToken.None,
            customerExplanation: "The restaurant closed before it could accept your order.");

        Assert.Contains("The restaurant closed before it could accept your order.", sender.Html, StringComparison.Ordinal);
        Assert.Contains("The restaurant closed before it could accept your order.", sender.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ADeclinedRefundPassesOnWhatTheRestaurantSaid()
    {
        var (service, sender) = CreateService();

        await service.SendRefundRejectedAsync(
            Order(),
            Payment(),
            null,
            "The order had already been prepared.",
            CancellationToken.None);

        Assert.Contains("The restaurant said: The order had already been prepared.", sender.Html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ADeclinedRefundWithNoNoteDoesNotPrintAnEmptyQuote()
    {
        var (service, sender) = CreateService();

        await service.SendRefundRejectedAsync(Order(), Payment(), null, "   ", CancellationToken.None);

        Assert.DoesNotContain("The restaurant said", sender.Html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AFailedRefundSaysTheMoneyDidNotMove()
    {
        var (service, sender) = CreateService();
        var refund = new PaymentRefund { AmountCents = 4_500, Currency = "aud" };

        await service.SendRefundFailedAsync(Order(), Payment(), refund, null, CancellationToken.None);

        Assert.Contains("No money has left our account", sender.Html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ValuesFromAnOrderCannotBreakOutIntoMarkup()
    {
        var (service, sender) = CreateService();
        var order = Order();
        order.OrderNumber = "<script>alert(1)</script>";
        var refund = new PaymentRefund { AmountCents = 4_500, Currency = "aud" };

        await service.SendRefundSucceededAsync(order, Payment(), refund, null, CancellationToken.None);

        Assert.DoesNotContain("<script>", sender.Html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;", sender.Html, StringComparison.Ordinal);
    }
}
