using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

public class OrderAutoAcceptanceServiceTests
{
    [Fact]
    public void RestaurantOperationsApi_RequiresStaffPolicy()
    {
        var authorize = typeof(RestaurantOperationsController)
            .GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.StaffApi, authorize!.Policy);
    }

    [Theory]
    [InlineData(PaymentMethod.PayAtCounter, PaymentStatus.Unpaid, true)]
    [InlineData(PaymentMethod.Online, PaymentStatus.Paid, true)]
    [InlineData(PaymentMethod.Online, PaymentStatus.Unpaid, false)]
    public async Task EnabledRestaurant_AcceptsOnlyPaymentEligibleOrders(
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus,
        bool expectedAccepted)
    {
        await using var dbContext = CreateDbContext();
        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = "Auto accept test",
            AutoAcceptOrders = true
        };
        dbContext.Restaurants.Add(restaurant);
        await dbContext.SaveChangesAsync();

        var order = CreateOrder(restaurant, paymentMethod, paymentStatus);
        dbContext.Orders.Add(order);
        var service = CreateService(dbContext);

        var accepted = await service.TryAcceptAsync(order, CancellationToken.None);

        Assert.Equal(expectedAccepted, accepted);
        Assert.Equal(
            expectedAccepted ? OrderStatus.Accepted : OrderStatus.Pending,
            order.Status);
        Assert.Equal(expectedAccepted ? 1 : 0, dbContext.OrderStatusHistories.Local.Count);
        if (expectedAccepted)
        {
            var audit = Assert.Single(dbContext.AuditLogs.Local);
            var orderEvent = Assert.Single(dbContext.OrderEventLogs.Local);
            Assert.Equal("Automation", audit.ActorType);
            Assert.Equal("DineFlow", audit.Source);
            Assert.Equal("Automation", orderEvent.ActorType);
            Assert.Equal(order.Id.ToString(), orderEvent.CorrelationId);
        }
    }

    [Fact]
    public async Task DisabledRestaurant_LeavesEligibleOrderPending()
    {
        await using var dbContext = CreateDbContext();
        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = "Manual accept test",
            AutoAcceptOrders = false
        };
        dbContext.Restaurants.Add(restaurant);
        await dbContext.SaveChangesAsync();

        var order = CreateOrder(restaurant, PaymentMethod.PayAtCounter, PaymentStatus.Unpaid);
        dbContext.Orders.Add(order);

        var accepted = await CreateService(dbContext).TryAcceptAsync(order, CancellationToken.None);

        Assert.False(accepted);
        Assert.Equal(OrderStatus.Pending, order.Status);
        Assert.Empty(dbContext.OrderStatusHistories.Local);
    }

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"auto-accept-{Guid.NewGuid():N}")
            .Options;
        return new AppDbContext(options);
    }

    private static OrderAutoAcceptanceService CreateService(AppDbContext dbContext)
    {
        var reportLogWriter = new ReportLogWriter(dbContext, new HttpContextAccessor());
        return new OrderAutoAcceptanceService(dbContext, reportLogWriter);
    }

    private static Order CreateOrder(
        Restaurant restaurant,
        PaymentMethod paymentMethod,
        PaymentStatus paymentStatus) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurant.Id,
        Restaurant = restaurant,
        OrderNumber = $"TEST-{Guid.NewGuid():N}",
        OrderType = OrderType.Takeaway,
        Status = OrderStatus.Pending,
        PaymentMethod = paymentMethod,
        PaymentStatus = paymentStatus,
        CreatedAt = DateTime.UtcNow
    };
}
