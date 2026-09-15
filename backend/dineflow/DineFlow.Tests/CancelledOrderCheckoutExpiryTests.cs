using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Stripe;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An A$7.50 Checkout was created at 22:51 and its order cancelled at 22:52. The hosted page stayed
/// chargeable until 23:51 — Stripe's ordinary hour — while the local attempt had said Cancelled the
/// whole time. For that hour the two systems disagreed about whether money could still be taken, and
/// the side that decides is Stripe's: a customer with the tab still open, or reaching it from their
/// browser history, could pay for an order whose stock had already been given to somebody else.
/// </summary>
public sealed class CancelledOrderCheckoutExpiryTests
{
    private static Order OrderWith(params Payment[] payments)
    {
        var order = new Order { Id = Guid.NewGuid(), OrderNumber = "ORD-1" };

        foreach (var payment in payments)
        {
            payment.OrderId = order.Id;
            order.Payments.Add(payment);
        }

        return order;
    }

    private static Payment StripeAttempt(
        PaymentStatus status = PaymentStatus.Pending,
        string? sessionId = "cs_test_live",
        string account = "acct_connected") =>
        new()
        {
            Id = Guid.NewGuid(),
            Provider = PaymentProviders.Stripe,
            ProviderCheckoutSessionId = sessionId,
            StripeAccountId = account,
            Status = status,
        };

    private static StripeCheckoutSessionExpiry Expiry(IStripeClient client, ReportLogWriter? log = null) =>
        new(
            client,
            log ?? new ReportLogWriter(InMemoryContext(), new HttpContextAccessor()),
            NullLogger<StripeCheckoutSessionExpiry>.Instance);

    private static AppDbContext InMemoryContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"expiry-{Guid.NewGuid()}")
            .Options);

    [Fact]
    public async Task ALiveSessionIsExpiredAtStripe()
    {
        var stripe = new StubStripeClient()
            .Answering("/checkout/sessions/cs_test_live/expire", new Stripe.Checkout.Session { Status = "expired" });
        var order = OrderWith(StripeAttempt());

        var closed = await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(1, closed);
        Assert.Contains(stripe.Requested, path => path.Contains("/expire", StringComparison.Ordinal));
    }

    [Fact]
    public async Task TheLocalAttemptStopsSayingItIsStillPayable()
    {
        var stripe = new StubStripeClient()
            .Answering("/expire", new Stripe.Checkout.Session { Status = "expired" });
        var order = OrderWith(StripeAttempt());

        await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(PaymentStatus.Expired, order.Payments.Single().Status);
    }

    [Theory]
    [InlineData(PaymentStatus.Pending)]
    [InlineData(PaymentStatus.Unpaid)]
    [InlineData(PaymentStatus.Failed)]
    [InlineData(PaymentStatus.Cancelled)]
    public void EveryAttemptACustomerCouldStillPayThroughCounts(PaymentStatus status)
    {
        // Cancelled is on the list on purpose: that is precisely the reported state — local record
        // closed, hosted page still open.
        Assert.True(StripeCheckoutSessionExpiry.IsStillChargeable(StripeAttempt(status)));
    }

    [Theory]
    [InlineData(PaymentStatus.Paid)]
    [InlineData(PaymentStatus.Refunded)]
    [InlineData(PaymentStatus.PartiallyRefunded)]
    [InlineData(PaymentStatus.Expired)]
    public void SettledMoneyIsLeftAlone(PaymentStatus status)
    {
        Assert.False(StripeCheckoutSessionExpiry.IsStillChargeable(StripeAttempt(status)));
    }

    [Fact]
    public void AnAttemptWithNoHostedPageHasNothingToClose()
    {
        Assert.False(StripeCheckoutSessionExpiry.IsStillChargeable(StripeAttempt(sessionId: null)));
    }

    [Fact]
    public void ACounterPaymentIsNotAStripeSession()
    {
        var counter = StripeAttempt();
        counter.Provider = PaymentProviders.CounterCash;

        Assert.False(StripeCheckoutSessionExpiry.IsStillChargeable(counter));
    }

    [Fact]
    public async Task TheRequestGoesToTheConnectedAccountThatOwnsTheSession()
    {
        // Sessions live on the restaurant's own account. Asked on the platform account this is a
        // 404, and the page would quietly stay live.
        var stripe = new RecordingStripeClient(new Stripe.Checkout.Session { Status = "expired" });
        var order = OrderWith(StripeAttempt(account: "acct_restaurant"));

        await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal("acct_restaurant", stripe.LastAccount);
    }

    [Fact]
    public async Task ASessionStripeHadAlreadyExpiredIsRecordedAsExpired()
    {
        var stripe = new ThrowingStripeClient(StripeErrorWith("checkout_session_expired", "Session already expired."));
        var order = OrderWith(StripeAttempt());

        var closed = await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(1, closed);
        Assert.Equal(PaymentStatus.Expired, order.Payments.Single().Status);
    }

    [Fact]
    public async Task ASessionSomebodyPaidInTheMeantimeIsNotRewrittenAsExpired()
    {
        // Recording a real payment as Expired would erase money that has actually moved. A
        // paid-but-cancelled order is a refund question, not a status one.
        var stripe = new ThrowingStripeClient(StripeErrorWith("checkout_session_completed", "Session already completed."));
        var order = OrderWith(StripeAttempt());

        var closed = await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(0, closed);
        Assert.Equal(PaymentStatus.Pending, order.Payments.Single().Status);
    }

    [Fact]
    public async Task AStripeOutageDoesNotStopTheOrderBeingCancelled()
    {
        // The alternative is an order a restaurant cannot cancel because a third party is down.
        var stripe = new ThrowingStripeClient(new StripeException("Stripe is unreachable."));
        var order = OrderWith(StripeAttempt());

        var closed = await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(0, closed);
        Assert.Equal(PaymentStatus.Pending, order.Payments.Single().Status);
    }

    [Fact]
    public async Task EveryLiveAttemptOnTheOrderIsClosed()
    {
        // Retrying checkout leaves more than one session behind, and closing only the newest leaves
        // an older page live.
        var stripe = new RecordingStripeClient(new Stripe.Checkout.Session { Status = "expired" });
        var order = OrderWith(
            StripeAttempt(sessionId: "cs_first"),
            StripeAttempt(sessionId: "cs_second"));

        var closed = await Expiry(stripe).ExpireOpenSessionsAsync(order, "customer-cancel", CancellationToken.None);

        Assert.Equal(2, closed);
        Assert.All(order.Payments, payment => Assert.Equal(PaymentStatus.Expired, payment.Status));
    }

    private static StripeException StripeErrorWith(string code, string message) =>
        new(message) { StripeError = new StripeError { Code = code, Message = message } };

    /// <summary>Answers every request the same way and remembers the account it was asked on.</summary>
    private sealed class RecordingStripeClient(IStripeEntity answer) : IStripeClient
    {
        public string? LastAccount { get; private set; }

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
            where T : IStripeEntity
        {
            LastAccount = requestOptions?.StripeAccount;
            return Task.FromResult((T)answer);
        }

        public Task<Stream> RequestStreamingAsync(
            HttpMethod method,
            string path,
            BaseOptions options,
            RequestOptions requestOptions,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class ThrowingStripeClient(Exception error) : IStripeClient
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
