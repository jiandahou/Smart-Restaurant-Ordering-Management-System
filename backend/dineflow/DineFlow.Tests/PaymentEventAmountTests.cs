using System.Reflection;
using DineFlow.Api.Contracts.Reports;
using DineFlow.Api.Controllers;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Payment events record what they were worth.
///
/// <para>
/// PaymentEventLog had no money on it at all. The rows are kept for seven years — a retention
/// period chosen for financial evidence — so a restaurant owner exporting their own seven years
/// could read that a counter tender was recorded, or a checkout session created, and by whom, and
/// never how much. The figure existed only inside DataJson, which is PlatformOwner-only, leaving
/// the people who actually reconcile takings to join back to the Payments table — a table this
/// log's immutability and retention rules do not cover.
/// </para>
/// </summary>
public sealed class PaymentEventAmountTests
{
    [Fact]
    public void PaymentEvent_RecordsThePaymentsAmountAndCurrency()
    {
        using var dbContext = CreateDbContext();
        var writer = new ReportLogWriter(dbContext, new HttpContextAccessor());
        var payment = new Payment { Id = Guid.NewGuid(), AmountCents = 4800, Currency = "aud" };

        writer.AddPaymentEvent(
            order: null,
            payment: payment,
            refund: null,
            eventType: "counter.recorded",
            providerEventId: null,
            status: "Paid",
            message: "Counter payment recorded.",
            provider: PaymentProviders.CounterCash);

        var log = Assert.Single(dbContext.PaymentEventLogs.Local);
        Assert.Equal(4800, log.AmountCents);
        Assert.Equal("aud", log.Currency);
    }

    /// A refund event is worth the refund, not the payment it came out of.
    [Fact]
    public void RefundEvent_RecordsTheRefundsAmount_NotThePaymentsTotal()
    {
        using var dbContext = CreateDbContext();
        var writer = new ReportLogWriter(dbContext, new HttpContextAccessor());
        var payment = new Payment { Id = Guid.NewGuid(), AmountCents = 4800, Currency = "aud" };
        var refund = new PaymentRefund
        {
            Id = Guid.NewGuid(),
            PaymentId = payment.Id,
            AmountCents = 1200,
            Currency = "aud"
        };

        writer.AddPaymentEvent(
            order: null,
            payment: payment,
            refund: refund,
            eventType: "refund.created",
            providerEventId: null,
            status: "Refunded",
            message: "Partial refund issued.");

        var log = Assert.Single(dbContext.PaymentEventLogs.Local);
        Assert.Equal(1200, log.AmountCents);
    }

    /// <summary>
    /// An event with neither a payment nor a refund behind it leaves the amount unset rather than
    /// claiming zero, which would read as a payment of nothing.
    /// </summary>
    [Fact]
    public void EventWithNoMoneyBehindIt_LeavesTheAmountUnset()
    {
        using var dbContext = CreateDbContext();
        var writer = new ReportLogWriter(dbContext, new HttpContextAccessor());

        writer.AddPaymentEvent(
            order: null,
            payment: null,
            refund: null,
            eventType: "webhook.ignored",
            providerEventId: "evt_1",
            status: null,
            message: "Duplicate event ignored.");

        var log = Assert.Single(dbContext.PaymentEventLogs.Local);
        Assert.Null(log.AmountCents);
        Assert.Null(log.Currency);
    }

    /// <summary>
    /// The point of the fix. What a payment was worth is the business fact a restaurant reconciles
    /// on, so it reaches every authorised reader — unlike DataJson and CorrelationId, which stay
    /// behind the PlatformOwner gate.
    /// </summary>
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AmountReachesEveryAuthorisedReader_UnlikeTheTechnicalFields(bool includeTechnicalDetails)
    {
        var log = new PaymentEventLog
        {
            Id = Guid.NewGuid(),
            AmountCents = 4800,
            Currency = "aud",
            DataJson = "{\"secret\":true}",
            CorrelationId = "corr-1"
        };

        var mapper = typeof(AdminReportsController)
            .GetMethod("MapPaymentEventLog", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(mapper);

        var mapped = Assert.IsType<PaymentEventLogResponse>(
            mapper!.Invoke(null, [log, includeTechnicalDetails]));

        Assert.Equal(4800, mapped.AmountCents);
        Assert.Equal("aud", mapped.Currency);
        Assert.Equal(includeTechnicalDetails, mapped.DataJson is not null);
        Assert.Equal(includeTechnicalDetails, mapped.CorrelationId is not null);
    }

    private static AppDbContext CreateDbContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"payment-event-amount-{Guid.NewGuid():N}")
            .Options);
}
