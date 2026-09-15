using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using DineFlow.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Stripe;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Order ORD-20260817-904880 read Expired in Orders and in Payments, and its payment timeline still
/// ended at checkout_session.created with status Pending. The state moved and the audit did not.
///
/// <para>
/// A payment timeline exists to answer one question — when did this stop being payable, and who
/// decided — and one that stops before the terminal transition cannot answer it. Worse, it reads as
/// though the session is still open, which is the opposite of what happened.
/// </para>
/// </summary>
public sealed class CheckoutExpiryAuditTests
{
    private static AppDbContext InMemoryContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"audit-{Guid.NewGuid()}")
            .Options);

    private static (Order Order, Payment Payment) UnpaidStripeOrder()
    {
        var order = new Order { Id = Guid.NewGuid(), OrderNumber = "ORD-20260817-904880" };
        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            ProviderCheckoutSessionId = "cs_test_904880",
            StripeAccountId = "acct_restaurant",
            Status = PaymentStatus.Pending,
        };

        order.Payments.Add(payment);
        return (order, payment);
    }

    [Fact]
    public async Task ClosingTheSessionIsWrittenToThePaymentTimeline()
    {
        var dbContext = InMemoryContext();
        var (order, _) = UnpaidStripeOrder();
        var expiry = new StripeCheckoutSessionExpiry(
            new StubStripeClient().Answering("/expire", new Stripe.Checkout.Session { Status = "expired" }),
            new ReportLogWriter(dbContext, new HttpContextAccessor()),
            NullLogger<StripeCheckoutSessionExpiry>.Instance);

        await expiry.ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        var logged = Assert.Single(dbContext.ChangeTracker.Entries<PaymentEventLog>().Select(entry => entry.Entity));

        Assert.Equal("checkout_session.expired", logged.EventType);
        Assert.Equal(nameof(PaymentStatus.Expired), logged.Status);
    }

    [Fact]
    public async Task TheEntryNamesTheOrderAndTheSession()
    {
        // A terminal transition nobody can trace back to an order or a provider object is not an
        // audit record, it is a line of prose.
        var dbContext = InMemoryContext();
        var (order, payment) = UnpaidStripeOrder();
        var expiry = new StripeCheckoutSessionExpiry(
            new StubStripeClient().Answering("/expire", new Stripe.Checkout.Session { Status = "expired" }),
            new ReportLogWriter(dbContext, new HttpContextAccessor()),
            NullLogger<StripeCheckoutSessionExpiry>.Instance);

        await expiry.ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        var logged = dbContext.ChangeTracker.Entries<PaymentEventLog>().Select(entry => entry.Entity).Single();

        Assert.Equal(order.Id, logged.OrderId);
        Assert.Equal(order.OrderNumber, logged.OrderNumber);
        Assert.Equal(payment.Id, logged.PaymentId);
        Assert.Equal(payment.ProviderCheckoutSessionId, logged.ProviderEventId);
    }

    [Fact]
    public async Task NothingIsWrittenWhenTheSessionWasPaidAfterAll()
    {
        // A "closed without payment" entry against money that did arrive would be worse than the
        // silence it replaces.
        var dbContext = InMemoryContext();
        var (order, _) = UnpaidStripeOrder();
        var completed = new StripeException("Session already completed.")
        {
            StripeError = new StripeError { Code = "checkout_session_completed", Message = "Session already completed." },
        };
        var expiry = new StripeCheckoutSessionExpiry(
            new AlwaysThrowingStripeClient(completed),
            new ReportLogWriter(dbContext, new HttpContextAccessor()),
            NullLogger<StripeCheckoutSessionExpiry>.Instance);

        await expiry.ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Empty(dbContext.ChangeTracker.Entries<PaymentEventLog>());
    }

    [Fact]
    public void TheSyncPathRecordsItToo()
    {
        // Two ways a session reaches its end — asked for, or Stripe's own hour — and the reported
        // order took the second one.
        var source = Source("PaymentSyncService.cs");
        var expired = source.IndexOf("session.Status == \"expired\"", StringComparison.Ordinal);

        Assert.True(expired >= 0);
        Assert.Contains("checkout_session.expired", source[expired..], StringComparison.Ordinal);
    }

    [Fact]
    public void TheReportKnowsWhatToCallIt()
    {
        // Unlabelled, the entry falls through to a humanised identifier and reads as a raw event
        // name in a list of sentences.
        var source = Source("AdminActivityReportService.cs");

        Assert.Contains("\"checkout_session.expired\" => \"Checkout expired\"", source, StringComparison.Ordinal);
        Assert.Contains("closed the Stripe checkout session", source, StringComparison.Ordinal);
    }

    private static string Source(string file)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !System.IO.File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return System.IO.File.ReadAllText(Path.Combine(directory!.FullName, "DineFlow.Api", "Services", file));
    }

    private sealed class AlwaysThrowingStripeClient(Exception error) : IStripeClient
    {
        public string ApiBase => "https://api.stripe.com";
        public string ApiKey => "sk_test_stub";
        public string ClientId => "ca_stub";
        public string ConnectBase => "https://connect.stripe.com";
        public string FilesBase => "https://files.stripe.com";
        public string MeterEventsBase => "https://meter-events.stripe.com";

        public Task<T> RequestAsync<T>(
            HttpMethod method,
            string path,
            BaseOptions options,
            RequestOptions requestOptions,
            CancellationToken cancellationToken = default)
            where T : IStripeEntity =>
            throw error;

        public Task<Stream> RequestStreamingAsync(
            HttpMethod method,
            string path,
            BaseOptions options,
            RequestOptions requestOptions,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
