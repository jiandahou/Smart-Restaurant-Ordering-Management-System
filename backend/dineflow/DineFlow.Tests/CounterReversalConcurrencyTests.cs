using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Real-database concurrency tests. Row locking cannot be exercised against an in-memory provider,
/// and these races are exactly where cash goes missing, so they run against PostgreSQL or not at all.
/// </summary>
public sealed class CounterReversalConcurrencyTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _paymentId;
    private Guid _orderId;

    private const long PaymentAmountCents = 10_000;

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
            Name = "Concurrency Test Kitchen",
            Currency = "aud",
            Timezone = "Australia/Sydney",
            IsActive = true
        };
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            OrderNumber = "ORD-CONCURRENCY-1",
            Status = OrderStatus.Ready,
            PaymentMethod = PaymentMethod.PayAtCounter,
            PaymentStatus = PaymentStatus.Paid,
            TotalAmount = 100m
        };
        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Provider = PaymentProviders.CounterCash,
            AmountCents = PaymentAmountCents,
            Currency = "aud",
            Status = PaymentStatus.Paid,
            TenderType = "Cash",
            PaidAt = DateTime.UtcNow
        };

        context.Restaurants.Add(restaurant);
        context.Orders.Add(order);
        context.Payments.Add(payment);
        await context.SaveChangesAsync();

        _orderId = order.Id;
        _paymentId = payment.Id;
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    [RequiresPostgresFact]
    public async Task ConcurrentOfflineRefunds_CannotExceedTheAmountCollected()
    {
        // Two cashiers each refund 60% of the payment at the same moment. Without a lock both read
        // a full balance and 120% of the money leaves the drawer.
        var gate = new TaskCompletionSource();
        var results = await RaceAsync(gate, RunRefundAsync(6_000, gate), RunRefundAsync(6_000, gate));

        Assert.Equal(1, results.Count(result => result.IsSuccess));
        Assert.Equal(1, results.Count(result => !result.IsSuccess && result.StatusCode == 409));

        await using var context = _database.CreateContext();
        var refunded = await context.PaymentRefunds
            .Where(refund => refund.PaymentId == _paymentId && refund.Status == PaymentRefundStatus.Succeeded)
            .SumAsync(refund => refund.AmountCents);

        Assert.Equal(6_000, refunded);
        Assert.True(refunded <= PaymentAmountCents, "Refunds must never exceed the amount collected.");
    }

    [RequiresPostgresFact]
    public async Task ConcurrentVoidAndRefund_CannotBothSucceed()
    {
        var gate = new TaskCompletionSource();
        var results = await RaceAsync(gate, RunVoidAsync(gate), RunRefundAsync(PaymentAmountCents, gate));

        // Whichever lands first wins; the other must be rejected rather than layered on top.
        Assert.Equal(1, results.Count(result => result.IsSuccess));

        await using var context = _database.CreateContext();
        var payment = await context.Payments
            .Include(item => item.Refunds)
            .FirstAsync(item => item.Id == _paymentId);

        var refunded = payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

        if (payment.VoidedAt is not null)
        {
            Assert.Equal(PaymentStatus.Cancelled, payment.Status);
            Assert.Equal(0, refunded);
        }
        else
        {
            Assert.Equal(PaymentStatus.Refunded, payment.Status);
            Assert.Equal(PaymentAmountCents, refunded);
        }
    }

    [RequiresPostgresFact]
    public async Task ConcurrentVoids_OnlyOneWins()
    {
        var gate = new TaskCompletionSource();
        var results = await RaceAsync(gate, RunVoidAsync(gate), RunVoidAsync(gate));

        Assert.Equal(1, results.Count(result => result.IsSuccess));
        Assert.Equal(1, results.Count(result => !result.IsSuccess && result.StatusCode == 409));
    }

    /// Each call gets its own DbContext, mirroring one scoped context per HTTP request.
    ///
    /// The gate is what makes the race deterministic: both callers load their snapshot, then wait
    /// until released together. Without it the tasks tend to run end to end one after the other and
    /// the test passes even against unlocked code.
    private async Task<CounterReversalResultSnapshot> RunRefundAsync(
        long amountCents,
        TaskCompletionSource? gate = null)
    {
        await using var context = _database.CreateContext();
        var (payment, order) = await LoadAsync(context);
        var service = TestServiceStubs.CreateReversalService(context);

        if (gate is not null)
        {
            await gate.Task;
        }

        var result = await service.RefundAsync(
            payment,
            order,
            amountCents,
            actorUserId: null,
            reason: "Concurrency test",
            CancellationToken.None);

        return new CounterReversalResultSnapshot(result.IsSuccess, result.StatusCode);
    }

    private async Task<CounterReversalResultSnapshot> RunVoidAsync(TaskCompletionSource? gate = null)
    {
        await using var context = _database.CreateContext();
        var (payment, order) = await LoadAsync(context);
        var service = TestServiceStubs.CreateReversalService(context);

        if (gate is not null)
        {
            await gate.Task;
        }

        var result = await service.VoidAsync(
            payment,
            order,
            actorUserId: null,
            reason: "Concurrency test",
            CancellationToken.None);

        return new CounterReversalResultSnapshot(result.IsSuccess, result.StatusCode);
    }

    /// Starts both operations, waits for each to have loaded its stale snapshot, then releases them
    /// into the critical section at the same instant.
    private static async Task<CounterReversalResultSnapshot[]> RaceAsync(
        TaskCompletionSource gate,
        params Task<CounterReversalResultSnapshot>[] operations)
    {
        await Task.Delay(150);
        gate.SetResult();
        return await Task.WhenAll(operations);
    }

    private async Task<(Payment Payment, Order Order)> LoadAsync(AppDbContext context)
    {
        var payment = await context.Payments
            .Include(item => item.Refunds)
            .FirstAsync(item => item.Id == _paymentId);
        var order = await context.Orders.FirstAsync(item => item.Id == _orderId);
        return (payment, order);
    }

    private sealed record CounterReversalResultSnapshot(bool IsSuccess, int StatusCode);
}
