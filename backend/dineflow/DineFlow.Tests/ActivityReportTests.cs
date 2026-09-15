using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Reports;
using DineFlow.Api.Controllers;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

public sealed class ActivityReportTests
{
    [Theory]
    [InlineData(nameof(AdminReportsController.GetActivity))]
    [InlineData(nameof(AdminReportsController.GetActivitySummary))]
    [InlineData(nameof(AdminReportsController.ExportActivity))]
    public void ActivityEndpoints_RequireAdminPolicy(string methodName)
    {
        var controllerPolicy = typeof(AdminReportsController)
            .GetCustomAttribute<AuthorizeAttribute>();
        var method = typeof(AdminReportsController)
            .GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance);

        Assert.NotNull(method);
        Assert.NotNull(controllerPolicy);
        Assert.Equal(AuthorizationPolicies.AdminApi, controllerPolicy!.Policy);
    }

    [Fact]
    public async Task ActivityFeed_ProducesHumanReadableActorsAmountsAndDescriptions()
    {
        await using var dbContext = CreateDbContext();
        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = "Activity Test Kitchen",
            Timezone = "Australia/Adelaide"
        };
        var orderId = Guid.NewGuid();
        var paymentId = Guid.NewGuid();
        dbContext.Restaurants.Add(restaurant);
        dbContext.OrderEventLogs.Add(new OrderEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            OrderId = orderId,
            OrderNumber = "ORD-TEST-100",
            ActorUserId = "staff-1",
            ActorDisplayName = "Jane Staff",
            ActorRoles = "Staff",
            ActorType = "User",
            Source = "DineFlow",
            EventType = "order.status_changed",
            Message = "ORD-TEST-100: Ready -> Completed.",
            DataJson = """{"previousStatus":"Ready","nextStatus":"Completed"}"""
        });
        dbContext.PaymentEventLogs.Add(new PaymentEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            OrderId = orderId,
            OrderNumber = "ORD-TEST-100",
            PaymentId = paymentId,
            Provider = "Counter",
            EventType = "counter.recorded",
            Status = "Paid",
            ActorUserId = "staff-1",
            ActorDisplayName = "Jane Staff",
            ActorRoles = "Staff",
            ActorType = "User",
            Source = "DineFlow",
            Message = "Counter payment recorded.",
            DataJson = """{"amountCents":4250,"currency":"aud"}"""
        });
        await dbContext.SaveChangesAsync();

        var result = await new AdminActivityReportService(dbContext).GetActivityAsync(
            new ActivityLogListRequest { Page = 1, PageSize = 20 },
            restaurant.Id,
            isPlatformOwner: false,
            includeTechnicalDetails: false,
            CancellationToken.None);

        Assert.Equal(2, result.TotalItems);
        Assert.Contains(result.Items, item =>
            item.ActorName == "Jane Staff" &&
            item.Description.Contains("completed order", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Items, item =>
            item.ActionLabel == "Counter payment received" &&
            item.AmountCents == 4250 &&
            item.Currency == "AUD");
        Assert.All(result.Items, item => Assert.Null(item.TechnicalJson));
        Assert.All(result.Items, item => Assert.Null(item.CorrelationId));
        Assert.All(result.Items, item => Assert.Equal("Activity Test Kitchen", item.RestaurantName));
    }

    [Fact]
    public void TechnicalLogMappings_RemoveSensitiveDetailsForRestaurantAdmins()
    {
        var audit = new DineFlow.Infrastructure.Reporting.AuditLog
        {
            Id = Guid.NewGuid(),
            Action = "MenuItem.Updated",
            EntityType = "MenuItem",
            CorrelationId = "correlation-secret",
            BeforeJson = "{\"price\":100}",
            AfterJson = "{\"price\":200}",
            IpAddress = "203.0.113.10",
            UserAgent = "sensitive-agent"
        };
        var order = new OrderEventLog
        {
            Id = Guid.NewGuid(),
            OrderId = Guid.NewGuid(),
            OrderNumber = "ORD-PRIVACY",
            EventType = "order.status_changed",
            Message = "Order updated.",
            CorrelationId = "order-correlation",
            DataJson = "{\"nextStatus\":\"Ready\"}"
        };
        var payment = new PaymentEventLog
        {
            Id = Guid.NewGuid(),
            Provider = "Stripe",
            EventType = "payment_intent.succeeded",
            Message = "Payment succeeded.",
            CorrelationId = "payment-correlation",
            DataJson = "{\"providerSecret\":\"hidden\"}"
        };

        var hiddenAudit = InvokeMapper<AuditLogResponse>("MapAuditLog", audit, false);
        var hiddenOrder = InvokeMapper<OrderEventLogResponse>("MapOrderEventLog", order, false);
        var hiddenPayment = InvokeMapper<PaymentEventLogResponse>("MapPaymentEventLog", payment, false);

        Assert.Null(hiddenAudit.CorrelationId);
        Assert.Null(hiddenAudit.BeforeJson);
        Assert.Null(hiddenAudit.AfterJson);
        Assert.Null(hiddenAudit.IpAddress);
        Assert.Null(hiddenAudit.UserAgent);
        Assert.Null(hiddenOrder.CorrelationId);
        Assert.Null(hiddenOrder.DataJson);
        Assert.Null(hiddenPayment.CorrelationId);
        Assert.Null(hiddenPayment.DataJson);

        var visibleAudit = InvokeMapper<AuditLogResponse>("MapAuditLog", audit, true);
        var visibleOrder = InvokeMapper<OrderEventLogResponse>("MapOrderEventLog", order, true);
        var visiblePayment = InvokeMapper<PaymentEventLogResponse>("MapPaymentEventLog", payment, true);

        Assert.Equal(audit.CorrelationId, visibleAudit.CorrelationId);
        Assert.Equal(audit.BeforeJson, visibleAudit.BeforeJson);
        Assert.Equal(audit.AfterJson, visibleAudit.AfterJson);
        Assert.Equal(order.CorrelationId, visibleOrder.CorrelationId);
        Assert.Equal(order.DataJson, visibleOrder.DataJson);
        Assert.Equal(payment.CorrelationId, visiblePayment.CorrelationId);
        Assert.Equal(payment.DataJson, visiblePayment.DataJson);
    }

    [Fact]
    public void CsvValues_PrefixSpreadsheetFormulas()
    {
        var formatter = typeof(AdminReportsController)
            .GetMethod("FormatCsvValue", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(formatter);
        Assert.Equal("'=2+2", formatter!.Invoke(null, ["=2+2"]));
        Assert.Equal("'@SUM(A1:A2)", formatter.Invoke(null, ["@SUM(A1:A2)"]));
    }

    [Fact]
    public void ReportRetention_RequiresExternalJobArchiveHoldAndCurrentRestoreDrill()
    {
        var now = new DateTimeOffset(2026, 8, 11, 0, 0, 0, TimeSpan.Zero);
        var options = new ReportRetentionOptions
        {
            ExternalMaintenanceEnabled = true,
            ScheduledJobReference = "ecs-task/report-retention:7",
            ArchiveDestination = "s3://dineflow-report-archive/production",
            LegalHoldRegister = "ops://legal-holds/reporting",
            LastRestoreDrillUtc = now.AddMonths(-6)
        };

        Assert.True(options.IsOperationallyConfigured(now));

        options.LastRestoreDrillUtc = now.AddYears(-1).AddDays(-1);
        Assert.False(options.IsOperationallyConfigured(now));

        options.LastRestoreDrillUtc = now.AddMonths(-6);
        options.LegalHoldRegister = string.Empty;
        Assert.False(options.IsOperationallyConfigured(now));
    }

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"activity-report-{Guid.NewGuid():N}")
            .Options;
        return new AppDbContext(options);
    }

    private static TResponse InvokeMapper<TResponse>(string methodName, object value, bool includeSensitiveDetails)
    {
        var mapper = typeof(AdminReportsController)
            .GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(mapper);
        return Assert.IsType<TResponse>(mapper!.Invoke(null, [value, includeSensitiveDetails]));
    }
}
