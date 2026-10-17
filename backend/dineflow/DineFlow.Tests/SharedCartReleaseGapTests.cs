using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DineFlow.Api.Contracts.Cart;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Restaurant;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

// HTTP integration probes against disposable PostgreSQL, never the running restaurant DB.
public sealed class SharedCartReleaseGapTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly Guid _restaurant = Guid.NewGuid();
    private readonly Guid _item = Guid.NewGuid();
    private readonly Guid _option = Guid.NewGuid();
    private readonly string _qr = Guid.NewGuid().ToString("N");
    public async Task InitializeAsync()
    {
        _api.Stripe = new StubStripeClient().Answering("/v1/refunds", new Stripe.Refund
        { Id = "re_gap_test", Amount = 1000, Currency = "aud", Status = "succeeded", PaymentIntentId = "pi_gap_test" });
        await _api.InitializeAsync();
        if (_api.ConnectionString is null) return;
        await _api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(new Restaurant
            {
                Id = _restaurant, Name = "Release Gap Kitchen", IsActive = true,
                Currency = "aud", Timezone = "Australia/Adelaide",
                OpeningHoursJson = JsonSerializer.Serialize(Enumerable.Range(0, 7).Select(day =>
                    new { dayOfWeek = day, isOpen = true, windows = new[] { new { opensAt = "00:00", closesAt = "00:00" } } }))
            });
            db.RestaurantTables.Add(new RestaurantTable { RestaurantId = _restaurant, TableNumber = "QA", QrToken = _qr });
            var category = new MenuCategory { RestaurantId = _restaurant, Name = "QA", IsActive = true };
            db.MenuCategories.Add(category);
            db.MenuItems.Add(new MenuItem { Id = _item, RestaurantId = _restaurant, CategoryId = category.Id, Name = "QA Dish", Price = 10m, IsAvailable = true, StockQuantity = 100 });
            var group = new MenuItemOptionGroup { RestaurantId = _restaurant, MenuItemId = _item, Name = "Extras", IsActive = true, MaxSelections = 1 };
            db.MenuItemOptionGroups.Add(group);
            db.MenuItemOptions.Add(new MenuItemOption { Id = _option, RestaurantId = _restaurant, MenuItemId = _item, GroupId = group.Id, Name = "QA Extra", IsAvailable = true, StockQuantity = 1 });
            await db.SaveChangesAsync();
        });
    }
    public Task DisposeAsync() => _api.DisposeAsync();
    private async Task<JoinCartResponse> Join(HttpClient client, bool table = true)
    {
        var response = await client.PostAsJsonAsync("/api/public/carts/join", table
            ? new JoinCartRequest { TableQrToken = _qr }
            : new JoinCartRequest { RestaurantId = _restaurant, OrderType = "Takeaway" });
        response.EnsureSuccessStatusCode();
        var joined = (await response.Content.ReadFromJsonAsync<JoinCartResponse>())!;
        client.DefaultRequestHeaders.Remove("X-Cart-Participant-Token");
        client.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined.ParticipantToken);
        return joined;
    }
    private Task<HttpResponseMessage> Add(HttpClient client, Guid cart, bool addon = false) =>
        client.PostAsJsonAsync($"/api/public/carts/{cart}/items", new AddCartItemRequest
        { MenuItemId = _item, Quantity = 1, SelectedOptionIds = addon ? [_option] : [] });
    private static Task<HttpResponseMessage> Checkout(HttpClient client, Guid cart) =>
        client.PostAsJsonAsync($"/api/public/carts/{cart}/checkout", new CheckoutCartRequest
        { AcceptedCustomerTermsVersion = "2026-08-08", AcknowledgedPrivacyPolicyVersion = "2026-08-08", AcknowledgedAllergenNoticeVersion = "2026-08-08" });

    [RequiresPostgresFact]
    public async Task CustomerCheckout_GuestRetryCannotClaimMyOrders()
    {
        using var customer = await _api.SignInAsAsync("mixed@dineflow.test", ApplicationRoles.Customer);
        using var guest = _api.CreateClient();
        var a = await Join(customer); var b = await Join(guest);
        Assert.Equal(a.Cart.Id, b.Cart.Id);
        (await Add(guest, b.Cart.Id)).EnsureSuccessStatusCode();
        var first = await Checkout(customer, a.Cart.Id); first.EnsureSuccessStatusCode();
        var original = (await first.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        var retry = await Checkout(guest, b.Cart.Id); retry.EnsureSuccessStatusCode();
        var recovered = (await retry.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        Assert.Equal(original.Order.Id, recovered.Order.Id);
        Assert.False(string.IsNullOrWhiteSpace(original.Order.CustomerId));
        Assert.Null(recovered.GuestAccessToken);
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync("/api/order/mine")).StatusCode);
        var lookup = await guest.PostAsJsonAsync("/api/order/guest", new { orders = new[] { new { orderId = original.Order.Id, guestAccessToken = b.ParticipantToken } } });
        lookup.EnsureSuccessStatusCode();
        Assert.Empty((await lookup.Content.ReadFromJsonAsync<JsonElement[]>())!);
    }

    [RequiresPostgresFact]
    public async Task SecondCustomerRetry_DoesNotTakeOrderOwnership()
    {
        using var first = await _api.SignInAsAsync("first@dineflow.test", ApplicationRoles.Customer);
        using var second = await _api.SignInAsAsync("second@dineflow.test", ApplicationRoles.Customer);
        var a = await Join(first); var b = await Join(second);
        Assert.Equal(a.Cart.Id, b.Cart.Id);
        (await Add(first, a.Cart.Id)).EnsureSuccessStatusCode();
        var placed = await Checkout(first, a.Cart.Id); placed.EnsureSuccessStatusCode();
        var original = (await placed.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        var retried = await Checkout(second, b.Cart.Id); retried.EnsureSuccessStatusCode();
        var recovered = (await retried.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        Assert.Equal(original.Order.Id, recovered.Order.Id);
        Assert.Equal(original.Order.CustomerId, recovered.Order.CustomerId);
        var mine = await second.GetFromJsonAsync<JsonElement[]>("/api/order/mine");
        Assert.Empty(mine!);
        await _api.UseDbAsync(async db => Assert.Equal(original.Order.CustomerId, (await db.Orders.SingleAsync()).CustomerId));
    }

    [RequiresPostgresFact]
    public async Task SignedOutParticipantToken_IsRejected()
    {
        using var customer = await _api.SignInAsAsync("logout@dineflow.test", ApplicationRoles.Customer);
        var joined = await Join(customer);
        using var guest = _api.CreateClient();
        guest.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined.ParticipantToken);
        var response = await Add(guest, joined.Cart.Id);
        Assert.False(response.IsSuccessStatusCode);
        Assert.Contains("participant_identity_changed", await response.Content.ReadAsStringAsync());
        await _api.UseDbAsync(async db => Assert.False(await db.CartItems.AnyAsync()));
    }

    // Characterization, not approval of the UX: joining as Customer does not make that
    // account the owner if a different, anonymous participant submits first.
    [RequiresPostgresFact]
    public async Task GuestSubmitsBeforeCustomer_OrderRemainsGuest()
    {
        using var customer = await _api.SignInAsAsync("joined-first@dineflow.test", ApplicationRoles.Customer);
        using var guest = _api.CreateClient();
        var a = await Join(customer); var b = await Join(guest);
        Assert.Equal(a.Cart.Id, b.Cart.Id);
        (await Add(customer, a.Cart.Id)).EnsureSuccessStatusCode();
        var response = await Checkout(guest, b.Cart.Id); response.EnsureSuccessStatusCode();
        var original = (await response.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        Assert.Null(original.Order.CustomerId);
        var retry = await Checkout(customer, a.Cart.Id); retry.EnsureSuccessStatusCode();
        var recovered = (await retry.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        Assert.Equal(original.Order.Id, recovered.Order.Id);
        Assert.Null(recovered.Order.CustomerId);
        Assert.Empty((await customer.GetFromJsonAsync<JsonElement[]>("/api/order/mine"))!);
    }

    [RequiresPostgresFact]
    public async Task FourParticipantsFortyAdds_ConvergeToForty()
    {
        var clients = Enumerable.Range(0, 4).Select(_ => _api.CreateClient()).ToArray();
        try
        {
            var carts = new List<JoinCartResponse>();
            foreach (var client in clients) carts.Add(await Join(client));
            Assert.Single(carts.Select(c => c.Cart.Id).Distinct());
            var id = carts[0].Cart.Id;
            var results = await Task.WhenAll(Enumerable.Range(0, 40).Select(i => Add(clients[i % 4], id)));
            foreach (var response in results) response.EnsureSuccessStatusCode();
            foreach (var client in clients)
            {
                var cart = await client.GetFromJsonAsync<CartResponse>($"/api/public/carts/{id}");
                Assert.Equal(40, cart!.Items.Sum(i => i.Quantity));
                Assert.Equal(400m, cart.Total);
            }
        }
        finally { foreach (var client in clients) client.Dispose(); }
    }

    [RequiresPostgresFact]
    public async Task TwoCartsCompeteForLastAddon_OnlyOneOrderReservesIt()
    {
        using var a = _api.CreateClient(); using var b = _api.CreateClient();
        var ca = await Join(a, false); var cb = await Join(b, false);
        (await Add(a, ca.Cart.Id, true)).EnsureSuccessStatusCode();
        (await Add(b, cb.Cart.Id, true)).EnsureSuccessStatusCode();
        var results = await Task.WhenAll(Checkout(a, ca.Cart.Id), Checkout(b, cb.Cart.Id));
        Assert.Single(results, r => r.IsSuccessStatusCode);
        Assert.Single(results, r => r.StatusCode == HttpStatusCode.Conflict);
        await _api.UseDbAsync(async db =>
        {
            Assert.Equal(0, (await db.MenuItemOptions.FindAsync(_option))!.StockQuantity);
            Assert.Equal(99, (await db.MenuItems.FindAsync(_item))!.StockQuantity);
            Assert.Equal(1, await db.Orders.CountAsync());
        });
    }

    private async Task<(HttpClient Customer, HttpClient Admin, Guid Order, Guid Request)> RefundRequest()
    {
        var customer = await _api.SignInAsAsync("refund@dineflow.test", ApplicationRoles.Customer);
        var admin = await _api.SignInAsAsync("reviewer@dineflow.test", ApplicationRoles.Admin, _restaurant);
        var cart = await Join(customer, false);
        (await Add(customer, cart.Cart.Id, true)).EnsureSuccessStatusCode();
        var checkout = await Checkout(customer, cart.Cart.Id); checkout.EnsureSuccessStatusCode();
        var placed = (await checkout.Content.ReadFromJsonAsync<CheckoutCartResponse>())!;
        Guid lineId = default;
        // Arrange a paid provider fixture only; the actual Stripe charge is deliberately not tested.
        await _api.UseDbAsync(async db =>
        {
            var order = await db.Orders.Include(o => o.OrderItems).SingleAsync();
            order.PaymentMethod = PaymentMethod.Online;
            order.PaymentStatus = PaymentStatus.Paid;
            order.Status = OrderStatus.Accepted;
            lineId = order.OrderItems.Single().Id;
            db.Payments.Add(new Payment { OrderId = order.Id, Provider = PaymentProviders.Stripe,
                ProviderPaymentIntentId = "pi_gap_test", StripeAccountId = "acct_gap_test",
                AmountCents = 1000, Currency = "aud", Status = PaymentStatus.Paid, PaidAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        });
        var response = await customer.PostAsJsonAsync($"/api/order/{placed.Order.Id}/refund-requests",
            new { reason = "QA request", items = new[] { new { orderItemId = lineId, quantity = 1 } } });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return (customer, admin, placed.Order.Id, body.GetProperty("id").GetGuid());
    }

    [RequiresPostgresFact]
    public async Task RefundRequestApprove_IsVisibleAndCannotRefundTwice()
    {
        var f = await RefundRequest();
        using var customer = f.Customer; using var admin = f.Admin;
        var route = $"/api/payments/refund-requests/{f.Request}/approve";
        var approved = await admin.PostAsJsonAsync(route, new { note = "QA approved" });
        Assert.True(approved.IsSuccessStatusCode, await approved.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync(route, new { note = "QA retry" })).StatusCode);
        var mine = await customer.GetStringAsync("/api/order/mine");
        Assert.Contains("Approved", mine);
        await _api.UseDbAsync(async db =>
        {
            Assert.Equal(1, await db.PaymentRefunds.CountAsync());
            Assert.Equal(1000, (await db.PaymentRefunds.SingleAsync()).AmountCents);
            Assert.Equal(OrderStatus.Cancelled, (await db.Orders.SingleAsync()).Status);
            Assert.Equal(100, (await db.MenuItems.FindAsync(_item))!.StockQuantity);
            Assert.Equal(1, (await db.MenuItemOptions.FindAsync(_option))!.StockQuantity);
        });
        Assert.Single(_api.Stripe!.Requested, p => p.Contains("/v1/refunds"));
    }

    [RequiresPostgresFact]
    public async Task RefundRequestReject_PreservesMoneyAndShowsReason()
    {
        var f = await RefundRequest();
        using var customer = f.Customer; using var admin = f.Admin;
        var route = $"/api/payments/refund-requests/{f.Request}/reject";
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync(route, new { note = " " })).StatusCode);
        (await admin.PostAsJsonAsync(route, new { note = "QA rejection reason" })).EnsureSuccessStatusCode();
        var mine = await customer.GetStringAsync("/api/order/mine");
        Assert.Contains("Rejected", mine);
        Assert.Contains("QA rejection reason", mine);
        await _api.UseDbAsync(async db =>
        {
            Assert.False(await db.PaymentRefunds.AnyAsync());
            Assert.Equal(PaymentStatus.Paid, (await db.Orders.SingleAsync()).PaymentStatus);
            Assert.Equal(99, (await db.MenuItems.FindAsync(_item))!.StockQuantity);
            Assert.Equal(0, (await db.MenuItemOptions.FindAsync(_option))!.StockQuantity);
        });
        Assert.Empty(_api.Stripe!.Requested);
    }
}
