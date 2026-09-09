using DineFlow.Api.Hubs;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.EntityFrameworkCore;
using Stripe;

namespace DineFlow.Tests.Infrastructure;

/// Minimal collaborators so the reversal service can be exercised against a real database without
/// dragging in SignalR or an HTTP pipeline.
public static class TestServiceStubs
{
    public static CounterPaymentReversalService CreateReversalService(AppDbContext context) =>
        new(
            context,
            CreateOrderRealtimeNotifier(),
            CreateStockLedger(context),
            CreateReportLogWriter(context),
            NullLogger<CounterPaymentReversalService>.Instance);

    /// Real, against the real database: a refund that settles an order gives its portions back, and
    /// a stub here would let that regress unnoticed.
    public static OrderStockLedger CreateStockLedger(AppDbContext context) =>
        new(context, new MenuItemStockService(context));

    public static OrderRealtimeNotifier CreateOrderRealtimeNotifier() =>
        new(new NoOpHubContext(), NullLogger<OrderRealtimeNotifier>.Instance);

    public static ReportLogWriter CreateReportLogWriter(AppDbContext context) =>
        new(context, new HttpContextAccessor());

    /// <summary>Real layout, unconfigured operator: enough to render, nothing to assert against.</summary>
    public static TransactionalEmailLayout CreateEmailLayout() =>
        new(Options.Create(new ComplianceOptions()));

    /// <summary>
    /// What a payment landing on an order does, wired to a real refund processor.
    /// </summary>
    /// <remarks>
    /// Takes the Stripe client because the interesting half is what happens when money arrives on an
    /// order the restaurant already turned away, and that path refunds.
    /// </remarks>
    public static OrderPaymentLanding CreateOrderPaymentLanding(
        AppDbContext context,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions)
    {
        var reportLogWriter = CreateReportLogWriter(context);

        return new OrderPaymentLanding(
            context,
            new OrderAutoAcceptanceService(context, reportLogWriter),
            new OrderRefundProcessor(
                context,
                stripeClient,
                stripeOptions,
                CreateOrderRealtimeNotifier(),
                CreatePaymentNotificationService(context),
                reportLogWriter,
                NullLogger<OrderRefundProcessor>.Instance),
            reportLogWriter,
            NullLogger<OrderPaymentLanding>.Instance);
    }

    public static PaymentNotificationService CreatePaymentNotificationService(AppDbContext? context = null) =>
        new(
            new TransactionalEmailOutbox(
                context ?? new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
                    .UseInMemoryDatabase($"stub-outbox-{Guid.NewGuid()}")
                    .Options),
                NullLogger<TransactionalEmailOutbox>.Instance),
            NullLogger<PaymentNotificationService>.Instance,
            CreateEmailLayout());

    private sealed class NoOpEmailSender : IEmailSender
    {
        public Task SendAsync(
            string to,
            string subject,
            string htmlBody,
            string? textBody = null,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class NoOpHubContext : IHubContext<OrderHub>
    {
        public IHubClients Clients { get; } = new NoOpHubClients();

        public IGroupManager Groups { get; } = new NoOpGroupManager();
    }

    private sealed class NoOpHubClients : IHubClients
    {
        public IClientProxy All { get; } = new NoOpClientProxy();

        public IClientProxy AllExcept(IReadOnlyList<string> excludedConnectionIds) => All;

        public IClientProxy Client(string connectionId) => All;

        public IClientProxy Clients(IReadOnlyList<string> connectionIds) => All;

        public IClientProxy Group(string groupName) => All;

        public IClientProxy GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => All;

        public IClientProxy Groups(IReadOnlyList<string> groupNames) => All;

        public IClientProxy User(string userId) => All;

        public IClientProxy Users(IReadOnlyList<string> userIds) => All;
    }

    private sealed class NoOpClientProxy : IClientProxy
    {
        public Task SendCoreAsync(
            string method,
            object?[] args,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class NoOpGroupManager : IGroupManager
    {
        public Task AddToGroupAsync(
            string connectionId,
            string groupName,
            CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task RemoveFromGroupAsync(
            string connectionId,
            string groupName,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
