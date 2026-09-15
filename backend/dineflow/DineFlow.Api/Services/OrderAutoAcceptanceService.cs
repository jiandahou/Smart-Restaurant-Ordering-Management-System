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
        var entry = dbContext.Entry(order);

        // New checkout orders do not exist in the database yet, and the in-memory provider used
        // by the fast unit tests cannot perform a conditional UPDATE. They are not exposed to a
        // second request, so the normal tracked write is sufficient for both cases.
        if (!dbContext.Database.IsRelational() || entry.State is EntityState.Added or EntityState.Detached)
        {
            RecordAcceptance(order, now);
            return true;
        }

        // Payment selection can arrive twice from two participants in the same cart. Both
        // requests used to read Pending, both wrote Accepted, and both added the same history and
        // audit event. Claim Pending -> Accepted on the row itself so only one request records the
        // transition. Save and commit here because a bare ExecuteUpdate followed by a caller's
        // later SaveChanges would leave an accepted order without its history if that save failed.
        var ownsTransaction = dbContext.Database.CurrentTransaction is null;
        await using var transaction = ownsTransaction
            ? await dbContext.Database.BeginTransactionAsync(cancellationToken)
            : null;

        try
        {
            var claimed = await dbContext.Orders
                .Where(candidate => candidate.Id == order.Id && candidate.Status == OrderStatus.Pending)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(candidate => candidate.Status, OrderStatus.Accepted)
                        .SetProperty(candidate => candidate.UpdatedAt, now),
                    cancellationToken);

            if (claimed == 0)
            {
                // Keep this context from writing its stale Pending value later, while preserving
                // caller changes such as the selected payment method.
                var currentStatus = await dbContext.Orders
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == order.Id)
                    .Select(candidate => candidate.Status)
                    .SingleAsync(cancellationToken);
                entry.Property(candidate => candidate.Status).CurrentValue = currentStatus;
                entry.Property(candidate => candidate.Status).OriginalValue = currentStatus;
                entry.Property(candidate => candidate.Status).IsModified = false;

                if (ownsTransaction)
                {
                    await transaction!.CommitAsync(cancellationToken);
                }

                return false;
            }

            RecordAcceptance(order, now);
            await dbContext.SaveChangesAsync(cancellationToken);

            if (ownsTransaction)
            {
                await transaction!.CommitAsync(cancellationToken);
            }

            return true;
        }
        catch
        {
            if (ownsTransaction && transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            throw;
        }
    }

    private void RecordAcceptance(Order order, DateTime now)
    {
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
    }
}
