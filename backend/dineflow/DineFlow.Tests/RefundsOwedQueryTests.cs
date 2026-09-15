using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// Counting the money a restaurant is holding from customers it turned away.
/// </summary>
/// <remarks>
/// <para>
/// Against a real database rather than an in-memory provider, because half of what is being checked
/// here is whether PostgreSQL can answer the question at all: the rule sums a subtraction across one
/// collection whose terms are themselves sums across another. A test on a provider that evaluates
/// that in memory would pass while the running service threw.
/// </para>
/// <para>
/// The other half is that this count and the refund itself must always name the same orders. A badge
/// that disagrees with the screen it points at sends someone looking for something that is not
/// there, and after that nobody believes the badge.
/// </para>
/// </remarks>
public sealed class RefundsOwedQueryTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _restaurantId;

    private static readonly DateTime TakenFirst = new(2026, 7, 13, 2, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime TakenLater = new(2026, 8, 14, 2, 0, 0, DateTimeKind.Utc);

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
            Name = "Turned Away Kitchen",
            Currency = "aud",
            Timezone = "Australia/Adelaide",
            IsActive = true,
        };
        context.Restaurants.Add(restaurant);
        _restaurantId = restaurant.Id;

        // Rejected with the money still here: the case the whole count exists for.
        context.Orders.Add(TurnedAway("ORD-OWED-1", OrderStatus.Rejected, Paid(9_900, TakenFirst)));

        // Cancelled, and the order's own summary has lost track of the charge. Counted from the
        // payment, so it appears — this is the row that used to be invisible everywhere.
        var stranded = TurnedAway("ORD-OWED-2", OrderStatus.Cancelled, Paid(2_550, TakenLater));
        stranded.PaymentStatus = PaymentStatus.Cancelled;
        context.Orders.Add(stranded);

        // Partly refunded: only the remainder is still owed.
        context.Orders.Add(TurnedAway(
            "ORD-OWED-3",
            OrderStatus.Cancelled,
            Paid(4_000, TakenLater, Refund(1_000))));

        // Already settled in full, so nothing is owed and it must not be counted.
        context.Orders.Add(TurnedAway(
            "ORD-SETTLED",
            OrderStatus.Rejected,
            Paid(5_000, TakenFirst, Refund(5_000))));

        // Turned away before anyone paid.
        context.Orders.Add(TurnedAway("ORD-UNPAID", OrderStatus.Rejected));

        // Still live, so its money is not owed back — it is money for food being cooked.
        context.Orders.Add(TurnedAway("ORD-LIVE", OrderStatus.Preparing, Paid(3_000, TakenLater)));

        // Settled in cash at the till: the platform never took it and has nothing to send back.
        var counter = TurnedAway("ORD-COUNTER", OrderStatus.Cancelled, Paid(2_000, TakenFirst));
        counter.PaymentMethod = PaymentMethod.PayAtCounter;
        context.Orders.Add(counter);

        // A refund that failed has given nothing back, so the money is still owed.
        context.Orders.Add(TurnedAway(
            "ORD-REFUND-FAILED",
            OrderStatus.Cancelled,
            Paid(1_500, TakenLater, Refund(1_500, PaymentRefundStatus.Failed))));

        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    private Order TurnedAway(string orderNumber, OrderStatus status, params Payment[] payments)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = _restaurantId,
            OrderNumber = orderNumber,
            Status = status,
            PaymentMethod = PaymentMethod.Online,
            PaymentStatus = payments.Length == 0 ? PaymentStatus.Unpaid : PaymentStatus.Paid,
            TotalAmount = 0m,
        };

        foreach (var payment in payments)
        {
            order.Payments.Add(payment);
        }

        return order;
    }

    private static Payment Paid(long amountCents, DateTime paidAt, params PaymentRefund[] refunds)
    {
        var payment = new Payment
        {
            Id = Guid.NewGuid(),
            Provider = PaymentProviders.Stripe,
            Status = PaymentStatus.Paid,
            AmountCents = amountCents,
            Currency = "aud",
            PaidAt = paidAt,
        };

        foreach (var refund in refunds)
        {
            payment.Refunds.Add(refund);
        }

        return payment;
    }

    private static PaymentRefund Refund(
        long amountCents,
        PaymentRefundStatus status = PaymentRefundStatus.Succeeded) =>
        new()
        {
            Id = Guid.NewGuid(),
            AmountCents = amountCents,
            Currency = "aud",
            Status = status,
        };

    [RequiresPostgresFact]
    public async Task ItCountsOnlyTheOrdersThatStillOweSomething()
    {
        await using var context = _database.CreateContext();

        var owed = (await RefundsOwedQuery.ByRestaurantAsync(context, [_restaurantId], CancellationToken.None))
            .GetValueOrDefault(_restaurantId, RefundsOwedQuery.RefundsOwed.None);

        Assert.Equal(4, owed.Count);
        Assert.Equal(9_900 + 2_550 + 3_000 + 1_500, owed.AmountCents);
    }

    /// <summary>
    /// The age is the customer's, so it runs from the charge — the thing they would be counting.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ItReportsWhenTheOldestOfThatMoneyWasTaken()
    {
        await using var context = _database.CreateContext();

        var owed = (await RefundsOwedQuery.ByRestaurantAsync(context, [_restaurantId], CancellationToken.None))
            .GetValueOrDefault(_restaurantId, RefundsOwedQuery.RefundsOwed.None);

        Assert.Equal(TakenFirst, owed.OldestTakenAt);
    }

    /// <summary>A restaurant with nothing outstanding is absent, not zero-filled.</summary>
    [RequiresPostgresFact]
    public async Task ARestaurantHoldingNothingIsNotListed()
    {
        await using var context = _database.CreateContext();

        var owed = await RefundsOwedQuery.ByRestaurantAsync(
            context,
            [Guid.NewGuid()],
            CancellationToken.None);

        Assert.Empty(owed);
    }

    [RequiresPostgresFact]
    public async Task AskingAboutNoRestaurantsAsksTheDatabaseNothing()
    {
        await using var context = _database.CreateContext();

        Assert.Empty(await RefundsOwedQuery.ByRestaurantAsync(context, [], CancellationToken.None));
    }
}
