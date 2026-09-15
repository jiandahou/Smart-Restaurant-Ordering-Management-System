using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Restaurant;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Settling a whole table, which is the largest amount of money this product moves in one call.
/// </summary>
/// <remarks>
/// <para>
/// A table bill is several orders paid at once, and settling it takes payment for every one of them,
/// completes every one of them and closes the session. Nothing tested it. The failure that matters is
/// not a wrong number on a screen — it is a table where three of four orders were charged and the
/// fourth was not, or a bill paid twice because two staff pressed settle at the same moment.
/// </para>
/// <para>
/// Runs against a real database because that is the only place all-or-nothing means anything.
/// </para>
/// </remarks>
public sealed class TableSettlementApiTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private readonly Guid _restaurantId = Guid.NewGuid();
    private readonly Guid _otherRestaurantId = Guid.NewGuid();
    private Guid _sessionId;
    private Guid _tableId;
    private readonly List<Guid> _orderIds = [];

    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.AddRange(
                FrontCounterScenario.Restaurant(_restaurantId, "Table Kitchen"),
                FrontCounterScenario.Restaurant(_otherRestaurantId, "Someone Else's Kitchen"));

            var table = FrontCounterScenario.Table(_restaurantId, "T1");
            _tableId = table.Id;
            context.RestaurantTables.Add(table);

            var session = FrontCounterScenario.OpenSession(_restaurantId, table.Id);
            _sessionId = session.Id;
            context.TableSessions.Add(session);

            // Three courses on one table: A$10, A$20 and A$30, settled together.
            foreach (var (number, total) in new[] { ("TBL-1", 10m), ("TBL-2", 20m), ("TBL-3", 30m) })
            {
                var order = FrontCounterScenario.ReadyCounterOrder(
                    _restaurantId, number, total, table.Id, session.Id);
                _orderIds.Add(order.Id);
                context.Orders.Add(order);
            }

            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("table-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private Task<HttpResponseMessage> SettleAsync(HttpClient client, decimal received) =>
        client.PostAsJsonAsync(
            $"/api/staff/front-counter/table-sessions/{_sessionId}/settle-complete",
            new { tender = "Cash", amountReceived = received });

    [RequiresPostgresFact]
    public async Task SettlesEveryOrderOnTheTableAndClosesIt()
    {
        var response = await SettleAsync(_staff, 60m);

        response.EnsureSuccessStatusCode();
        await _api.UseDbAsync(async context =>
        {
            var orders = await context.Orders.AsNoTracking()
                .Where(order => _orderIds.Contains(order.Id))
                .ToListAsync();

            Assert.All(orders, order => Assert.Equal(OrderStatus.Completed, order.Status));
            Assert.All(orders, order => Assert.Equal(PaymentStatus.Paid, order.PaymentStatus));

            var session = await context.TableSessions.AsNoTracking().SingleAsync(item => item.Id == _sessionId);
            Assert.Equal(TableSessionStatus.Closed, session.Status);
        });
    }

    /// <summary>
    /// All or nothing. A refusal partway through must leave the table exactly as it was, because the
    /// alternative is a table where some courses are paid for and nobody can say which.
    /// </summary>
    [RequiresPostgresFact]
    public async Task LeavesTheTableUntouchedWhenOneOrderCannotBeSettled()
    {
        // One course is still being cooked, so the table is not ready to close.
        await _api.UseDbAsync(async context =>
        {
            var order = await context.Orders.SingleAsync(item => item.Id == _orderIds[1]);
            order.Status = OrderStatus.Preparing;
            await context.SaveChangesAsync();
        });

        var response = await SettleAsync(_staff, 60m);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        await _api.UseDbAsync(async context =>
        {
            var orders = await context.Orders.AsNoTracking()
                .Where(order => _orderIds.Contains(order.Id))
                .ToListAsync();

            Assert.DoesNotContain(orders, order => order.Status == OrderStatus.Completed);
            Assert.All(orders, order => Assert.Equal(PaymentStatus.Unpaid, order.PaymentStatus));

            var taken = 0L;
            foreach (var id in _orderIds)
            {
                taken += await FrontCounterScenario.CounterPaymentTotalAsync(context, id);
            }
            Assert.Equal(0, taken);

            var session = await context.TableSessions.AsNoTracking().SingleAsync(item => item.Id == _sessionId);
            Assert.Equal(TableSessionStatus.Open, session.Status);
        });
    }

    /// <summary>Cash that does not cover the whole table is not a settlement.</summary>
    [RequiresPostgresFact]
    public async Task RefusesCashThatDoesNotCoverTheWholeTable()
    {
        var response = await SettleAsync(_staff, 45m);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertNothingWasTakenAsync();
    }

    [RequiresPostgresFact]
    public async Task RefusesStaffFromAnotherRestaurant()
    {
        var outsider = await _api.SignInAsAsync(
            "outsider@dineflow.test", ApplicationRoles.Staff, _otherRestaurantId);

        var response = await SettleAsync(outsider, 60m);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await AssertNothingWasTakenAsync();
    }

    /// <summary>
    /// Two staff pressing settle on the same table at the same moment.
    /// </summary>
    /// <remarks>
    /// The one that matters. A table bill charged twice is money taken from a customer who is already
    /// walking out of the door, and nothing on the screen would show it.
    /// </remarks>
    [RequiresPostgresFact]
    public async Task ChargesTheTableOnceWhenTwoStaffSettleItTogether()
    {
        var second = await _api.SignInAsAsync("table-staff-2@dineflow.test", ApplicationRoles.Staff, _restaurantId);

        var responses = await Task.WhenAll(
            SettleAsync(_staff, 60m),
            SettleAsync(second, 60m));

        var taken = 0L;
        await _api.UseDbAsync(async context =>
        {
            foreach (var id in _orderIds)
            {
                taken += await FrontCounterScenario.CounterPaymentTotalAsync(context, id);
            }
        });

        // A$60 exactly. Twice would be A$120, and nothing on any screen would show it.
        Assert.Equal(6_000, taken);
        Assert.Equal(1, responses.Count(response => response.IsSuccessStatusCode));
    }

    private async Task AssertNothingWasTakenAsync() =>
        await _api.UseDbAsync(async context =>
        {
            foreach (var id in _orderIds)
            {
                Assert.Equal(0, await FrontCounterScenario.CounterPaymentTotalAsync(context, id));
            }
        });
}
