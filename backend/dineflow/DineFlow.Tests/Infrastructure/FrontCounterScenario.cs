using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using DineFlow.Infrastructure.Restaurant;

namespace DineFlow.Tests.Infrastructure;

/// <summary>
/// Builds a counter worth testing against: a restaurant, a table, and orders in the states the
/// front counter actually meets.
/// </summary>
/// <remarks>
/// Shared so the API tests and the concurrency tests describe the same counter. A test that has to
/// spell out seven entities before it can say anything is a test nobody adds a case to.
/// </remarks>
public static class FrontCounterScenario
{
    public static RestaurantEntity Restaurant(Guid id, string name) => new()
    {
        Id = id,
        Name = name,
        Currency = "aud",
        Timezone = "Australia/Sydney",
        IsActive = true
    };

    public static RestaurantTable Table(Guid restaurantId, string number) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurantId,
        TableNumber = number,
        QrToken = Guid.NewGuid().ToString("N"),
        Capacity = 4,
        IsActive = true
    };

    /// <summary>An order ready to hand over with the money still owed at the till.</summary>
    public static Order ReadyCounterOrder(
        Guid restaurantId,
        string number,
        decimal total = 10m,
        Guid? tableId = null,
        Guid? tableSessionId = null) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurantId,
        TableId = tableId,
        TableSessionId = tableSessionId,
        OrderNumber = number,
        OrderType = tableId.HasValue ? OrderType.DineIn : OrderType.Takeaway,
        Status = OrderStatus.Ready,
        PaymentStatus = PaymentStatus.Unpaid,
        PaymentMethod = PaymentMethod.PayAtCounter,
        TotalAmount = total,
        CreatedAt = DateTime.UtcNow.AddMinutes(-10)
    };

    public static TableSession OpenSession(Guid restaurantId, Guid tableId) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurantId,
        TableId = tableId,
        Status = TableSessionStatus.Open,
        OpenedAt = DateTime.UtcNow.AddHours(-1)
    };

    /// <summary>What the till actually took, in cents, for one order.</summary>
    public static async Task<long> CounterPaymentTotalAsync(AppDbContext context, Guid orderId)
    {
        var payments = context.Payments
            .Where(payment =>
                payment.OrderId == orderId &&
                payment.Status == PaymentStatus.Paid &&
                (payment.Provider == PaymentProviders.Counter ||
                 payment.Provider == PaymentProviders.CounterCash ||
                 payment.Provider == PaymentProviders.CounterCard));

        return await Task.FromResult(payments.Sum(payment => (long?)payment.AmountCents) ?? 0);
    }
}
