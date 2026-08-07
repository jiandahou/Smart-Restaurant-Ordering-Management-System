using DineFlow.Api.Hubs;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging.Abstractions;

namespace DineFlow.Tests.Infrastructure;

/// Minimal collaborators so the reversal service can be exercised against a real database without
/// dragging in SignalR or an HTTP pipeline.
public static class TestServiceStubs
{
    public static CounterPaymentReversalService CreateReversalService(AppDbContext context) =>
        new(
            context,
            CreateOrderRealtimeNotifier(),
            CreateReportLogWriter(context),
            NullLogger<CounterPaymentReversalService>.Instance);

    public static OrderRealtimeNotifier CreateOrderRealtimeNotifier() =>
        new(new NoOpHubContext(), NullLogger<OrderRealtimeNotifier>.Instance);

    public static ReportLogWriter CreateReportLogWriter(AppDbContext context) =>
        new(context, new HttpContextAccessor());

    public static PaymentNotificationService CreatePaymentNotificationService() =>
        new(new NoOpEmailSender(), NullLogger<PaymentNotificationService>.Instance);

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
