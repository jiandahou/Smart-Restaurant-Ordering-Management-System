using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

public sealed class OrderAutoAcceptanceConcurrencyTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private readonly Guid _orderId = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();
        var restaurant = new RestaurantEntity
        {
            Id = Guid.NewGuid(),
            Name = "Atomic Auto Accept Kitchen",
            Currency = "AUD",
            Timezone = "Australia/Adelaide",
            IsActive = true,
            AutoAcceptOrders = true
        };
        context.Restaurants.Add(restaurant);
        context.Orders.Add(new Order
        {
            Id = _orderId,
            RestaurantId = restaurant.Id,
            OrderNumber = $"AUTO-{Guid.NewGuid():N}",
            OrderType = OrderType.Takeaway,
            Status = OrderStatus.Pending,
            PaymentMethod = PaymentMethod.Online,
            PaymentStatus = PaymentStatus.Unpaid,
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    [RequiresPostgresFact]
    public async Task TwoStalePaymentSelections_RecordOneAcceptance()
    {
        await using var firstContext = _database.CreateContext();
        await using var secondContext = _database.CreateContext();

        // Both participants deliberately read the same old state before either selects payment.
        var firstOrder = await firstContext.Orders.SingleAsync(order => order.Id == _orderId);
        var secondOrder = await secondContext.Orders.SingleAsync(order => order.Id == _orderId);
        firstOrder.PaymentMethod = PaymentMethod.PayAtCounter;
        secondOrder.PaymentMethod = PaymentMethod.PayAtCounter;

        var firstService = CreateService(firstContext);
        var secondService = CreateService(secondContext);
        var results = await Task.WhenAll(
            firstService.TryAcceptAsync(firstOrder, CancellationToken.None),
            secondService.TryAcceptAsync(secondOrder, CancellationToken.None));

        Assert.Single(results, result => result);

        await using var verification = _database.CreateContext();
        Assert.Equal(OrderStatus.Accepted, await verification.Orders
            .Where(order => order.Id == _orderId)
            .Select(order => order.Status)
            .SingleAsync());
        Assert.Equal(1, await verification.OrderStatusHistories.CountAsync(history =>
            history.OrderId == _orderId &&
            history.PreviousStatus == OrderStatus.Pending &&
            history.NewStatus == OrderStatus.Accepted));
        Assert.Equal(1, await verification.AuditLogs.CountAsync(log =>
            log.EntityId == _orderId.ToString() && log.Action == "Order.AutoAccepted"));
        Assert.Equal(1, await verification.OrderEventLogs.CountAsync(log =>
            log.OrderId == _orderId && log.EventType == "order.auto_accepted"));
    }

    private static OrderAutoAcceptanceService CreateService(
        DineFlow.Infrastructure.Persistence.AppDbContext context) =>
        new(context, new ReportLogWriter(context, new HttpContextAccessor()));
}
