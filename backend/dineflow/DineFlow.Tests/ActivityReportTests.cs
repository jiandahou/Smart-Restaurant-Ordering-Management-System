using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Reports;
using DineFlow.Api.Controllers;
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
        Assert.All(result.Items, item => Assert.Equal("Activity Test Kitchen", item.RestaurantName));
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

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"activity-report-{Guid.NewGuid():N}")
            .Options;
        return new AppDbContext(options);
    }
}
