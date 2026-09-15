using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The staff screen's queue counts were worked out from whichever hundred rows the current page held,
/// so changing the sort changed them: same restaurant, same filters, 402 orders, and "Active" read 14
/// newest-first and 26 oldest-first. On a kitchen screen that can read zero while work is waiting.
/// </summary>
public class StaffOrderQueueTests
{
    private static readonly DateTime Now = new(2026, 8, 15, 20, 0, 0, DateTimeKind.Utc);

    private static bool Matches(
        string queue,
        OrderStatus status,
        PaymentStatus payment = PaymentStatus.Paid,
        PaymentMethod method = PaymentMethod.Online,
        int minutesOld = 5) =>
        StaffOrderQueue.Matches(queue, status, payment, method, Now.AddMinutes(-minutesOld), Now);

    [Fact]
    public void LiveWorkIsActive()
    {
        Assert.True(Matches("active", OrderStatus.Pending));
        Assert.True(Matches("active", OrderStatus.Preparing));
        Assert.False(Matches("active", OrderStatus.Completed));
    }

    [Fact]
    public void EachLaneTakesItsOwnStatuses()
    {
        Assert.True(Matches("new", OrderStatus.Pending));
        Assert.False(Matches("new", OrderStatus.Preparing));
        Assert.True(Matches("kitchen", OrderStatus.Accepted));
        Assert.True(Matches("kitchen", OrderStatus.Preparing));
        Assert.True(Matches("ready", OrderStatus.Ready));
    }

    [Theory]
    [InlineData(OrderStatus.Completed)]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void FinishedWorkIsClosed(OrderStatus status)
    {
        Assert.True(Matches("closed", status));
        Assert.False(Matches("active", status));
    }

    /// <summary>An order waiting on money is not the kitchen's to start.</summary>
    [Fact]
    public void AnUnpaidOnlineOrderIsAPaymentHoldAndNotActive()
    {
        Assert.True(Matches("payment", OrderStatus.Pending, PaymentStatus.Unpaid));
        Assert.False(Matches("active", OrderStatus.Pending, PaymentStatus.Unpaid));
        Assert.False(Matches("new", OrderStatus.Pending, PaymentStatus.Unpaid));
    }

    /// <summary>Counter orders are collected at the till, so being unpaid holds nothing up.</summary>
    [Fact]
    public void AnUnpaidCounterOrderIsStillTheKitchensToMake()
    {
        Assert.False(Matches("payment", OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.PayAtCounter));
        Assert.True(Matches("active", OrderStatus.Pending, PaymentStatus.Unpaid, PaymentMethod.PayAtCounter));
    }

    /// <summary>Refunded means the money went back; the pan should stop.</summary>
    [Fact]
    public void ARefundedOrderIsAHold()
    {
        Assert.True(Matches("payment", OrderStatus.Accepted, PaymentStatus.Refunded));
        Assert.False(Matches("active", OrderStatus.Accepted, PaymentStatus.Refunded));
    }

    [Fact]
    public void AnOrderStillOpenADayLaterIsCarriedOver()
    {
        Assert.True(Matches("carried", OrderStatus.Accepted, minutesOld: 60 * 25));
        Assert.False(Matches("active", OrderStatus.Accepted, minutesOld: 60 * 25));
    }

    /// <summary>A hold is a hold first: it needs a decision, not chasing for being slow.</summary>
    [Fact]
    public void APaymentHoldIsNotAlsoCountedAsCarriedOverOrLate()
    {
        Assert.False(Matches("carried", OrderStatus.Pending, PaymentStatus.Unpaid, minutesOld: 60 * 25));
        Assert.False(Matches("late", OrderStatus.Pending, PaymentStatus.Unpaid, minutesOld: 60));
    }

    [Fact]
    public void AnOrderWaitingTooLongIsLate()
    {
        Assert.False(Matches("late", OrderStatus.Accepted, minutesOld: 19));
        Assert.True(Matches("late", OrderStatus.Accepted, minutesOld: 21));
    }

    /// <summary>
    /// The database runs its own copy of these rules, so the two are checked against each other over
    /// every combination there is. A queue whose rows and whose count disagree is the bug this fix is
    /// about, wearing different clothes.
    /// </summary>
    [Fact]
    public void TheDatabasesCopyOfTheRulesAgreesWithThisOne()
    {
        var ages = new[]
        {
            ("fresh", Now.AddMinutes(-1)),
            ("overdue", Now.AddMinutes(-21)),
            ("a day old", Now.AddHours(-25)),
        };

        var disagreements = new List<string>();

        foreach (var queue in StaffOrderQueue.All)
        {
            var runsOnTheDatabase = StaffOrderQueue.Predicate(queue, Now).Compile();

            foreach (var status in Enum.GetValues<OrderStatus>())
            foreach (var paymentStatus in Enum.GetValues<PaymentStatus>())
            foreach (var method in Enum.GetValues<PaymentMethod>())
            foreach (var (ageName, createdAt) in ages)
            {
                var order = new Order
                {
                    Status = status,
                    PaymentStatus = paymentStatus,
                    PaymentMethod = method,
                    CreatedAt = createdAt,
                };

                var here = StaffOrderQueue.Matches(queue, status, paymentStatus, method, createdAt, Now);
                var there = runsOnTheDatabase(order);

                if (here != there)
                {
                    disagreements.Add($"{queue}: {status}/{paymentStatus}/{method}/{ageName} — this says {here}, the database says {there}");
                }
            }
        }

        Assert.Empty(disagreements);
    }

    /// <summary>Counting one queue must not silently forget another exists.</summary>
    [Fact]
    public void EveryQueueTheScreenShowsIsNamed()
    {
        Assert.Equal(
            new[] { "active", "new", "kitchen", "ready", "late", "payment", "carried", "closed" },
            StaffOrderQueue.All);
    }

    /// <summary>
    /// An unrecognised queue name must be refused. Matching nothing instead would tell a kitchen with
    /// work waiting that it has none.
    /// </summary>
    [Fact]
    public void AnUnknownQueueIsNotOneOfTheScreens()
    {
        Assert.True(StaffOrderQueue.IsKnown("active"));
        Assert.False(StaffOrderQueue.IsKnown("everything"));
        Assert.False(StaffOrderQueue.IsKnown(null));
        Assert.False(Matches("everything", OrderStatus.Pending));
    }
}
