using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Finding a counter payment after the pickup is over.
/// </summary>
/// <remarks>
/// <para>
/// The void and offline-refund endpoints work from a payment id and never cared what state the order
/// reached. What was missing was any way to reach one: completing a pickup takes the order out of the
/// counter's working lists, and the reversal controls live on those lists — so a payment became
/// unreachable at precisely the moment a customer was most likely to come back about it, which is
/// after they have their food and are looking at their bank app.
/// </para>
/// <para>
/// Run against PostgreSQL: the query filters on a collection of payments and orders by the latest of
/// them, and neither survives an in-memory provider honestly.
/// </para>
/// </remarks>
public sealed class FrontCounterRecentPaymentsTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _restaurantId;
    private Guid _otherRestaurantId;

    private static readonly DateTime Now = new(2026, 8, 15, 12, 0, 0, DateTimeKind.Utc);

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();

        _restaurantId = Guid.NewGuid();
        _otherRestaurantId = Guid.NewGuid();
        context.Restaurants.AddRange(
            Restaurant(_restaurantId, "Counter Kitchen"),
            Restaurant(_otherRestaurantId, "Someone Else's Kitchen"));

        var customer = new ApplicationUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = "customer.one@dineflow.test",
            NormalizedUserName = "CUSTOMER.ONE@DINEFLOW.TEST",
            Email = "customer.one@dineflow.test",
            NormalizedEmail = "CUSTOMER.ONE@DINEFLOW.TEST",
            FullName = "Customer One"
        };
        context.Users.Add(customer);

        // The case the fix is for: paid at the counter, pickup finished, customer comes back.
        Add(context, "COMPLETED-PAID", OrderStatus.Completed, PaymentStatus.Paid,
            PaymentProviders.CounterCash, Now.AddHours(-2), customer.Id);
        // Still in the queue — reachable before and after.
        Add(context, "READY-PAID", OrderStatus.Ready, PaymentStatus.Paid,
            PaymentProviders.CounterCard, Now.AddHours(-1));
        // Partly refunded already: another refund may still be owed.
        Add(context, "COMPLETED-PART-REFUNDED", OrderStatus.Completed, PaymentStatus.PartiallyRefunded,
            PaymentProviders.Counter, Now.AddHours(-3));
        // Already voided: nothing left to reverse, and nothing to offer.
        Add(context, "COMPLETED-VOIDED", OrderStatus.Completed, PaymentStatus.Cancelled,
            PaymentProviders.CounterCash, Now.AddHours(-4));
        // Yesterday's trade. This is a counter tool, not the ledger.
        Add(context, "OLD-PAID", OrderStatus.Completed, PaymentStatus.Paid,
            PaymentProviders.CounterCash, Now.AddHours(-30));
        // Paid online: not this counter's to reverse.
        Add(context, "ONLINE-PAID", OrderStatus.Completed, PaymentStatus.Paid,
            PaymentProviders.Stripe, Now.AddHours(-1));
        // Another restaurant's takings.
        Add(context, "OTHER-RESTAURANT", OrderStatus.Completed, PaymentStatus.Paid,
            PaymentProviders.CounterCash, Now.AddHours(-1), restaurantId: _otherRestaurantId);

        await context.SaveChangesAsync();
    }

    private static RestaurantEntity Restaurant(Guid id, string name) => new()
    {
        Id = id,
        Name = name,
        Currency = "aud",
        Timezone = "Australia/Sydney",
        IsActive = true
    };

    private void Add(
        AppDbContext context,
        string number,
        OrderStatus status,
        PaymentStatus paymentStatus,
        string provider,
        DateTime paidAt,
        string? customerId = null,
        Guid? restaurantId = null)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId ?? _restaurantId,
            CustomerId = customerId,
            OrderNumber = number,
            Status = status,
            PaymentStatus = paymentStatus,
            PaymentMethod = provider == PaymentProviders.Stripe
                ? PaymentMethod.Online
                : PaymentMethod.PayAtCounter,
            TotalAmount = 10m,
            CreatedAt = paidAt.AddMinutes(-20)
        };

        context.Orders.Add(order);
        context.Payments.Add(new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Provider = provider,
            Status = paymentStatus,
            AmountCents = 1_000,
            Currency = "aud",
            CreatedAt = paidAt
        });
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    /// <summary>The very query the endpoint runs.</summary>
    private IQueryable<Order> RecentCounterPayments(AppDbContext context) =>
        context.Orders
            .AsNoTracking()
            .Where(FrontCounterRecentPayments.Predicate(_restaurantId, Now));

    private async Task<List<string>> FoundAsync()
    {
        await using var context = _database.CreateContext();
        return await RecentCounterPayments(context)
            .Select(order => order.OrderNumber)
            .OrderBy(number => number)
            .ToListAsync();
    }

    /// <summary>The whole point: a finished pickup's payment is still findable.</summary>
    [RequiresPostgresFact]
    public async Task FindsACounterPaymentWhosePickupIsAlreadyFinished()
    {
        Assert.Contains("COMPLETED-PAID", await FoundAsync());
    }

    /// <summary>Partly refunded still has money that could be owed back.</summary>
    [RequiresPostgresFact]
    public async Task KeepsAPartlyRefundedPaymentWithinReach()
    {
        Assert.Contains("COMPLETED-PART-REFUNDED", await FoundAsync());
    }

    /// <summary>Orders still in the queue do not disappear from view because this list exists.</summary>
    [RequiresPostgresFact]
    public async Task StillShowsPaymentsForOrdersThatAreNotFinished()
    {
        Assert.Contains("READY-PAID", await FoundAsync());
    }

    [RequiresPostgresFact]
    public async Task LeavesOutWhatThisCounterCannotReverse()
    {
        var found = await FoundAsync();

        // Nothing left to reverse.
        Assert.DoesNotContain("COMPLETED-VOIDED", found);
        // Taken online: reversing it is Stripe's business, not the till's.
        Assert.DoesNotContain("ONLINE-PAID", found);
    }

    /// <summary>A counter tool, not an accounts ledger.</summary>
    [RequiresPostgresFact]
    public async Task ReachesBackOnlyAsFarAsTheWindow()
    {
        Assert.DoesNotContain("OLD-PAID", await FoundAsync());
    }

    /// <summary>One restaurant's takings are not another's to reverse.</summary>
    [RequiresPostgresFact]
    public async Task NeverReachesAnotherRestaurantsTakings()
    {
        Assert.DoesNotContain("OTHER-RESTAURANT", await FoundAsync());
    }

    /// <summary>
    /// Newest first: the payment being asked about is nearly always the last one taken.
    /// </summary>
    [RequiresPostgresFact]
    public async Task PutsTheMostRecentPaymentFirst()
    {
        await using var context = _database.CreateContext();

        var ordered = await RecentCounterPayments(context)
            .OrderByDescending(FrontCounterRecentPayments.LastTakenAt())
            .Select(order => order.OrderNumber)
            .ToListAsync();

        Assert.Equal(["READY-PAID", "COMPLETED-PAID", "COMPLETED-PART-REFUNDED"], ordered);
    }
}
