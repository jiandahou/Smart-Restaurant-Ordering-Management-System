using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed class TableSessionService(AppDbContext dbContext)
{
    public async Task<TableSession> GetOrCreateOpenSessionAsync(
        Guid restaurantId,
        Guid tableId,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        var session = await dbContext.TableSessions
            .FirstOrDefaultAsync(
                item =>
                    item.RestaurantId == restaurantId &&
                    item.TableId == tableId &&
                    item.Status == TableSessionStatus.Open,
                cancellationToken);

        if (session is not null)
        {
            return session;
        }

        session = new TableSession
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            TableId = tableId,
            Status = TableSessionStatus.Open,
            OpenedAt = utcNow,
            CreatedAt = utcNow
        };

        await dbContext.TableSessions.AddAsync(session, cancellationToken);
        return session;
    }

    public static bool IsActiveOrder(DineFlow.Infrastructure.Orders.Order order) =>
        order.Status is not
            DineFlow.Infrastructure.Orders.OrderStatus.Completed and not
            DineFlow.Infrastructure.Orders.OrderStatus.Cancelled and not
            DineFlow.Infrastructure.Orders.OrderStatus.Rejected;
}
