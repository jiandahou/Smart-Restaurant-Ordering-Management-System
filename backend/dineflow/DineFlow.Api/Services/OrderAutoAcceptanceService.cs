using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed class OrderAutoAcceptanceService(
    AppDbContext dbContext,
    ReportLogWriter reportLogWriter)
{
    public async Task<bool> TryAcceptAsync(
        Order order,
        CancellationToken cancellationToken)
    {
        if (order.Status != OrderStatus.Pending ||
            !OrderPaymentEligibility.CanProcess(order.PaymentMethod, order.PaymentStatus))
        {
            return false;
        }

        var autoAcceptEnabled = order.Restaurant?.AutoAcceptOrders
            ?? await dbContext.Restaurants
                .AsNoTracking()
                .Where(restaurant => restaurant.Id == order.RestaurantId)
                .Select(restaurant => restaurant.AutoAcceptOrders)
                .SingleOrDefaultAsync(cancellationToken);

        if (!autoAcceptEnabled)
        {
            return false;
        }

        var now = DateTime.UtcNow;
        var automationActor = ReportActor.Automation();
        var correlationId = order.Id.ToString();
        order.Status = OrderStatus.Accepted;
        order.UpdatedAt = now;
        dbContext.OrderStatusHistories.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PreviousStatus = OrderStatus.Pending,
            NewStatus = OrderStatus.Accepted,
            Action = OrderTransitionAction.Accept.ToString(),
            Reason = "Accepted automatically by restaurant setting.",
            CreatedAt = now
        });
        reportLogWriter.AddAudit(
            "Order.AutoAccepted",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"{order.OrderNumber}: {OrderStatus.Pending} -> {OrderStatus.Accepted}.",
            before: new { status = OrderStatus.Pending.ToString() },
            after: new
            {
                status = OrderStatus.Accepted.ToString(),
                action = OrderTransitionAction.Accept.ToString(),
                automatic = true
            },
            actorOverride: automationActor,
            correlationId: correlationId);
        reportLogWriter.AddOrderEvent(
            order,
            "order.auto_accepted",
            $"{order.OrderNumber} was accepted automatically.",
            new
            {
                previousStatus = OrderStatus.Pending.ToString(),
                status = OrderStatus.Accepted.ToString()
            },
            actorOverride: automationActor,
            correlationId: correlationId);
        return true;
    }
}
