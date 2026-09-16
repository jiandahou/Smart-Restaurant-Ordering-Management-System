using System.Net;
using System.Net.Http.Json;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

namespace DineFlow.Tests;

public sealed class AuditCustomerCancellationRaceTests
{
    [RequiresPostgresFact]
    public async Task CustomerCancellationMustNotOverwriteAcceptedOrder()
    {
        await using var api = new DineFlowApiFactory();
        await api.InitializeAsync();
        var restaurantId = Guid.NewGuid();
        var order = FrontCounterScenario.ReadyCounterOrder(restaurantId, "AUDIT-CANCEL");
        order.Status = OrderStatus.Pending;
        var guest = GuestAccessTokenService.Issue();
        order.GuestAccessTokenHash = guest.Hash;
        var category = new DineFlow.Infrastructure.Menu.MenuCategory { Id = Guid.NewGuid(), RestaurantId = restaurantId, Name = "Audit food" };
        var dish = new DineFlow.Infrastructure.Menu.MenuItem { Id = Guid.NewGuid(), RestaurantId = restaurantId, CategoryId = category.Id, Name = "Last portion", Price = 10m, StockQuantity = 0, IsSoldOut = true };
        order.OrderItems.Add(new OrderItem { MenuItemId = dish.Id, MenuItemNameSnapshot = dish.Name, Quantity = 1, UnitPrice = 10m });
        await api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(FrontCounterScenario.Restaurant(restaurantId, "Audit cancellation kitchen"));
            db.MenuCategories.Add(category);
            db.MenuItems.Add(dish);
            db.Orders.Add(order);
            await db.SaveChangesAsync();
        });
        using var staff = await api.SignInAsAsync("audit-cancel-staff@dineflow.test", ApplicationRoles.Staff, restaurantId);
        using var customer = api.CreateClient();
        var control = FrontCounterScenario.ReadyCounterOrder(restaurantId, "AUDIT-CANCEL-CONTROL");
        control.Status = OrderStatus.Pending;
        control.GuestAccessTokenHash = guest.Hash;
        await api.UseDbAsync(async db => { db.Orders.Add(control); await db.SaveChangesAsync(); });
        (await staff.PostAsJsonAsync($"/api/admin/orders/{control.Id}/transitions", new { action = "Accept", expectedStatus = "Pending" })).EnsureSuccessStatusCode();
        var sequential = await customer.PostAsJsonAsync($"/api/order/{control.Id}/cancel", new { guestAccessToken = guest.Token });
        Assert.Equal(HttpStatusCode.Conflict, sequential.StatusCode);
        await using var holder = new NpgsqlConnection(api.ConnectionString);
        await holder.OpenAsync();
        await using var transaction = await holder.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT 1 FROM \"Orders\" WHERE \"Id\" = @id FOR UPDATE", holder, transaction))
        {
            command.Parameters.AddWithValue("id", order.Id);
            await command.ExecuteScalarAsync();
        }
        var accept = staff.PostAsJsonAsync($"/api/admin/orders/{order.Id}/transitions", new { action = "Accept", expectedStatus = "Pending" });
        Task<HttpResponseMessage>? cancel = null;
        try
        {
            await WaitForLocks(api.ConnectionString!, 1);
            cancel = customer.PostAsJsonAsync($"/api/order/{order.Id}/cancel", new { reason = "Changed my mind", guestAccessToken = guest.Token });
            await WaitForLocks(api.ConnectionString!, 2);
        }
        finally
        {
            await transaction.RollbackAsync();
        }
        var accepted = await accept;
        accepted.EnsureSuccessStatusCode();
        var cancelled = await cancel!;
        string state = "";
        await api.UseDbAsync(async db =>
        {
            var saved = await db.Orders.SingleAsync(o => o.Id == order.Id);
            var histories = await db.OrderStatusHistories.Where(h => h.OrderId == order.Id).Select(h => h.Action).ToListAsync();
            var stock = await db.MenuItems.Where(m => m.Id == dish.Id).Select(m => m.StockQuantity).SingleAsync();
            state = $"sequentialCancel={(int)sequential.StatusCode}; remainingStock={stock}; status={saved.Status}; stockReleased={saved.StockReleasedAt.HasValue}; history={string.Join(',', histories)}";
        });
        Assert.True(cancelled.StatusCode == HttpStatusCode.Conflict,
            $"Accept HTTP={(int)accepted.StatusCode}; cancel HTTP={(int)cancelled.StatusCode}; {state}");
    }

    private static async Task WaitForLocks(string connectionString, int count)
    {
        await using var observer = new NpgsqlConnection(connectionString);
        await observer.OpenAsync();
        for (var i = 0; i < 100; i++)
        {
            await using var command = new NpgsqlCommand("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'", observer);
            if ((long)(await command.ExecuteScalarAsync())! >= count) return;
            await Task.Delay(50);
        }
        throw new TimeoutException($"Expected {count} blocked requests");
    }
}