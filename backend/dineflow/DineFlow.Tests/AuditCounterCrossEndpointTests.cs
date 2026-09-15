using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace DineFlow.Tests;

public sealed class AuditCounterCrossEndpointTests
{
    [RequiresPostgresFact]
    public async Task SinglePaymentAndTableSettlementMustNotCollectTwice()
    {
        await using var api = new DineFlowApiFactory();
        await api.InitializeAsync();
        var restaurantId = Guid.NewGuid();
        var table = FrontCounterScenario.Table(restaurantId, "AUDIT");
        var session = FrontCounterScenario.OpenSession(restaurantId, table.Id);
        var order = FrontCounterScenario.ReadyCounterOrder(restaurantId, "AUDIT-CROSS", 10m, table.Id, session.Id);
        await api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(FrontCounterScenario.Restaurant(restaurantId, "Audit Kitchen"));
            db.RestaurantTables.Add(table);
            db.TableSessions.Add(session);
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION audit_pause_payment() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock(9152026);
                    RETURN NEW;
                END $$;
                CREATE TRIGGER audit_pause_payment BEFORE INSERT ON "Payments"
                FOR EACH ROW EXECUTE FUNCTION audit_pause_payment();
                """);
        });
        using var staff = await api.SignInAsAsync("audit-counter@dineflow.test", ApplicationRoles.Staff, restaurantId);
        await using var holder = new NpgsqlConnection(api.ConnectionString);
        await holder.OpenAsync();
        await using var tx = await holder.BeginTransactionAsync();
        await using (var hold = new NpgsqlCommand("SELECT pg_advisory_xact_lock(9152026)", holder, tx))
            await hold.ExecuteNonQueryAsync();
        var single = staff.PostAsJsonAsync($"/api/staff/front-counter/orders/{order.Id}/record-payment", new { tender = "Cash", amountReceived = 10m });
        Task<HttpResponseMessage>? wholeTable = null;
        try
        {
            await WaitForBlockedRequests(api.ConnectionString!, 1);
            wholeTable = staff.PostAsJsonAsync($"/api/staff/front-counter/table-sessions/{session.Id}/settle-complete", new { tender = "Cash", amountReceived = 10m });
            await WaitForBlockedRequests(api.ConnectionString!, 2);
        }
        finally
        {
            await tx.RollbackAsync();
        }
        var first = await single;
        var second = await wholeTable!;
        first.EnsureSuccessStatusCode();
        second.EnsureSuccessStatusCode();
        await api.UseDbAsync(async db =>
            Assert.Equal(1000, await FrontCounterScenario.CounterPaymentTotalAsync(db, order.Id)));
    }

    [RequiresPostgresFact]
    public async Task CompletedOrderVoidedPaymentCanBeCorrected()
    {
        await using var api = new DineFlowApiFactory();
        await api.InitializeAsync();
        var restaurantId = Guid.NewGuid();
        var order = FrontCounterScenario.ReadyCounterOrder(restaurantId, "AUDIT-VOID");
        await api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(FrontCounterScenario.Restaurant(restaurantId, "Audit Kitchen"));
            db.Orders.Add(order);
            await db.SaveChangesAsync();
        });
        using var staff = await api.SignInAsAsync("audit-void@dineflow.test", ApplicationRoles.Staff, restaurantId);
        var route = $"/api/staff/front-counter/orders/{order.Id}";
        (await staff.PostAsJsonAsync(route + "/record-payment", new { tender = "Cash", amountReceived = 10m })).EnsureSuccessStatusCode();
        (await staff.PostAsJsonAsync(route + "/complete", new { })).EnsureSuccessStatusCode();
        Guid paymentId = default;
        await api.UseDbAsync(async db => paymentId = await db.Payments.Where(p => p.OrderId == order.Id).Select(p => p.Id).SingleAsync());
        (await staff.PostAsJsonAsync($"/api/staff/front-counter/payments/{paymentId}/void", new { reason = "Wrong tender, replace with card" })).EnsureSuccessStatusCode();
        var corrected = await staff.PostAsJsonAsync(route + "/record-payment", new { tender = "Card" });
        Assert.True(corrected.IsSuccessStatusCode, $"Correction rejected: {corrected.StatusCode} {await corrected.Content.ReadAsStringAsync()}");
    }
    private static async Task WaitForBlockedRequests(string connectionString, int count)
    {
        await using var observer = new NpgsqlConnection(connectionString);
        await observer.OpenAsync();
        for (var attempt = 0; attempt < 100; attempt++)
        {
            await using var command = new NpgsqlCommand("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'", observer);
            if ((long)(await command.ExecuteScalarAsync())! >= count) return;
            await Task.Delay(50);
        }
        throw new TimeoutException($"Did not observe {count} blocked requests.");
    }
}
