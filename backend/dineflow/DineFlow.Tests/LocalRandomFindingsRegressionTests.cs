using System.Net;
using System.Net.Http.Json;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Tests.Infrastructure;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The four defects the 2026-09-16 random-testing run confirmed against a local stack
/// (LOCAL-0916-01..04 in the consolidated report, problems #12-15).
/// </summary>
public sealed class LocalRandomFindingsRegressionTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    /// Midnight to midnight on every day, which the hours service reads as a full day.
    private const string AlwaysOpenHoursJson =
        "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}]";

    public Task InitializeAsync() => _api.InitializeAsync();

    public Task DisposeAsync() => _api.DisposeAsync();

    /// <summary>
    /// Guards the fixture rather than the product. Every cart in this file needs its restaurant to
    /// be taking orders, and the entity default is 09:00-21:00 — so the first CI run answered 409
    /// "outside opening hours" on four tests that had passed locally, purely because the runner was
    /// at 22:08 in the seeded timezone. Runs without PostgreSQL, so the constant cannot rot
    /// unnoticed on a machine that skips the rest of this class.
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(9)]
    [InlineData(13)]
    [InlineData(22)]
    [InlineData(23)]
    public void TheSeededRestaurantIsOpenAtEveryHour(int hourOfDay)
    {
        var restaurant = new RestaurantEntity
        {
            Id = Guid.NewGuid(),
            Name = "Fixture Kitchen",
            Timezone = "Australia/Adelaide",
            IsActive = true,
            OpeningHoursJson = AlwaysOpenHoursJson
        };

        // Walked in UTC across a whole day, so every local hour in that timezone is covered.
        var midnightUtc = new DateTime(2026, 9, 16, 0, 0, 0, DateTimeKind.Utc);
        Assert.True(
            RestaurantOperatingHoursService.IsAcceptingOrders(restaurant, midnightUtc.AddHours(hourOfDay)),
            $"the fixture restaurant refused orders {hourOfDay}h into the day");
    }

    // ---- #12 · Guest checkout retry handed back an unusable credential ------------------------

    /// <summary>
    /// The retry branch exists for the response that never arrived: a guest who lost their only
    /// credential can prove the same cart participation and be issued another.
    ///
    /// <para>
    /// It assigned the new hash to an order loaded <c>AsNoTracking</c> and called SaveChangesAsync,
    /// which wrote nothing. The guest was handed a token whose hash was never stored — it could not
    /// read the order and could not cancel it — while the first token, the one being replaced, went
    /// on working. A client that did as told and overwrote its stored credential lost the order.
    /// </para>
    /// </summary>
    [RequiresPostgresFact]
    public async Task GuestCheckoutRetry_ReissuesACredentialThatActuallyWorks()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Retry Kitchen", "Retry Dish");
        var guest = _api.CreateClient();

        var join = await guest.PostAsJsonAsync("/api/public/carts/join",
            new { restaurantId, orderType = "Takeaway" });
        join.EnsureSuccessStatusCode();
        var joined = await join.Content.ReadFromJsonAsync<JoinPayload>();
        Assert.NotNull(joined);
        guest.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined!.ParticipantToken);

        var add = await guest.PostAsJsonAsync($"/api/public/carts/{joined.Cart.Id}/items",
            new { menuItemId = itemId, quantity = 1 });
        add.EnsureSuccessStatusCode();

        var first = await Checkout(guest, joined.Cart.Id);
        var retry = await Checkout(guest, joined.Cart.Id);

        // Same order both times, and the retry really does hand something back.
        Assert.Equal(first!.Order.Id, retry!.Order.Id);
        Assert.False(string.IsNullOrWhiteSpace(retry.GuestAccessToken));
        Assert.NotEqual(first.GuestAccessToken, retry.GuestAccessToken);

        // The point of the fix: the credential the retry returned can reach the order. The guest
        // lookup answers 200 with an empty list when it cannot prove the caller, so the row count
        // is the assertion and the status code would pass either way.
        Assert.Equal(1, await GuestLookupCount(retry.Order.Id, retry.GuestAccessToken));

        // And can act on it, which is what 403 on cancel made impossible before.
        var cancel = await _api.CreateClient().PostAsJsonAsync(
            $"/api/order/{retry.Order.Id}/cancel",
            new { guestAccessToken = retry.GuestAccessToken, reason = "regression" });
        Assert.NotEqual(HttpStatusCode.Forbidden, cancel.StatusCode);
    }

    /// <summary>
    /// The flip side, and the reason the old behaviour was dangerous rather than merely useless:
    /// only one credential is live at a time, so a superseded one must stop working. Before the
    /// fix the opposite held — the superseded token kept working and the new one never did.
    /// </summary>
    [RequiresPostgresFact]
    public async Task GuestCheckoutRetry_RetiresTheCredentialItReplaced()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Retry Kitchen Two", "Retry Dish Two");
        var guest = _api.CreateClient();

        var join = await guest.PostAsJsonAsync("/api/public/carts/join",
            new { restaurantId, orderType = "Takeaway" });
        var joined = await join.Content.ReadFromJsonAsync<JoinPayload>();
        guest.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined!.ParticipantToken);
        await guest.PostAsJsonAsync($"/api/public/carts/{joined.Cart.Id}/items",
            new { menuItemId = itemId, quantity = 1 });

        var first = await Checkout(guest, joined.Cart.Id);
        var retry = await Checkout(guest, joined.Cart.Id);

        Assert.Equal(1, await GuestLookupCount(retry!.Order.Id, retry.GuestAccessToken));
        Assert.Equal(0, await GuestLookupCount(first!.Order.Id, first.GuestAccessToken));
    }

    // ---- #13 · Deleting a menu item a cart referenced returned 500 ----------------------------

    /// <summary>
    /// The delete removed the row outright, and CartItem restricts that foreign key, so the caller
    /// got a 500 carrying PostgreSQL 23503. A customer holding the dish now is a real conflict and
    /// is answered as one, with something the operator can actually do instead.
    /// </summary>
    [RequiresPostgresFact]
    public async Task DeletingAnItemHeldInALiveCart_IsRefusedInsteadOfCrashing()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Delete Kitchen", "Doomed Dish");
        var guest = _api.CreateClient();
        var join = await guest.PostAsJsonAsync("/api/public/carts/join",
            new { restaurantId, orderType = "Takeaway" });
        if (!join.IsSuccessStatusCode)
            Assert.Fail($"Cart fixture join failed: {(int)join.StatusCode} {await join.Content.ReadAsStringAsync()}");
        var joined = await join.Content.ReadFromJsonAsync<JoinPayload>();
        guest.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined!.ParticipantToken);
        await guest.PostAsJsonAsync($"/api/public/carts/{joined.Cart.Id}/items",
            new { menuItemId = itemId, quantity = 1 });

        var admin = await _api.SignInAsAsync("delete-admin@dineflow.test", ApplicationRoles.Admin, restaurantId);
        var response = await admin.DeleteAsync($"/api/admin/menu/items/{itemId}");

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("menu_item_in_active_cart", body);
        Assert.DoesNotContain("23503", body);
    }

    /// <summary>
    /// Refusing whenever any cart row points at the dish would be worse than the crash: submitted
    /// and expired carts stay in the table, so a single order would make an item undeletable for
    /// good. Nobody is looking at those, and what was ordered is recorded on the order.
    /// </summary>
    [RequiresPostgresFact]
    public async Task DeletingAnItemHeldOnlyInAFinishedCart_Succeeds()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Delete Kitchen Two", "Retired Dish");
        var guest = _api.CreateClient();
        var join = await guest.PostAsJsonAsync("/api/public/carts/join",
            new { restaurantId, orderType = "Takeaway" });
        if (!join.IsSuccessStatusCode)
            Assert.Fail($"Cart fixture join failed: {(int)join.StatusCode} {await join.Content.ReadAsStringAsync()}");
        var joined = await join.Content.ReadFromJsonAsync<JoinPayload>();
        guest.DefaultRequestHeaders.Add("X-Cart-Participant-Token", joined!.ParticipantToken);
        await guest.PostAsJsonAsync($"/api/public/carts/{joined.Cart.Id}/items",
            new { menuItemId = itemId, quantity = 1 });

        await _api.UseDbAsync(async db =>
        {
            var cart = await db.Carts.FindAsync(joined.Cart.Id);
            cart!.Status = CartStatus.Expired;
            await db.SaveChangesAsync();
        });

        var admin = await _api.SignInAsAsync("delete-admin2@dineflow.test", ApplicationRoles.Admin, restaurantId);
        var response = await admin.DeleteAsync($"/api/admin/menu/items/{itemId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ---- #14 · Option groups accepted a negative lower bound ----------------------------------

    /// <summary>
    /// A required group was held at one or more. An optional one had no floor, so a group asking
    /// for minus two choices was stored exactly as sent.
    /// </summary>
    [RequiresPostgresFact]
    public async Task OptionGroup_RefusesANegativeLowerBound()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Bounds Kitchen", "Configurable Dish");
        var admin = await _api.SignInAsAsync("bounds-admin@dineflow.test", ApplicationRoles.Admin, restaurantId);

        var negative = await admin.PostAsJsonAsync($"/api/menu/items/{itemId}/option-groups",
            new { name = "Negative bounds", isRequired = false, minSelections = -2, maxSelections = 1, displayOrder = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, negative.StatusCode);

        // Zero is the ordinary floor for an optional group and stays allowed.
        var zero = await admin.PostAsJsonAsync($"/api/menu/items/{itemId}/option-groups",
            new { name = "Optional extras", isRequired = false, minSelections = 0, maxSelections = 1, displayOrder = 0 });
        Assert.Equal(HttpStatusCode.Created, zero.StatusCode);
    }

    // ---- #15 · Stock adjustment overflowed the column -----------------------------------------

    /// <summary>
    /// The count is adjusted by the database in one statement, which is what keeps two people
    /// pressing the button at once from losing an increment — but on an integer column that
    /// statement raised 22003 at the top of the range.
    /// </summary>
    [RequiresPostgresFact]
    public async Task StockAdjustment_IsRefusedAtTheCeilingInsteadOfOverflowing()
    {
        var (restaurantId, itemId) = await SeedMenuAsync("Stock Kitchen", "Countable Dish");
        var admin = await _api.SignInAsAsync("stock-admin@dineflow.test", ApplicationRoles.Admin, restaurantId);

        // The absolute set is bounded too, so the state the overflow needed cannot be reached.
        var absurd = await admin.PatchAsJsonAsync($"/api/admin/menu/items/{itemId}/stock",
            new { stockQuantity = int.MaxValue });
        Assert.Equal(HttpStatusCode.BadRequest, absurd.StatusCode);

        var atCeiling = await admin.PatchAsJsonAsync($"/api/admin/menu/items/{itemId}/stock",
            new { stockQuantity = MenuStockPolicy.MaximumStockQuantity });
        Assert.Equal(HttpStatusCode.OK, atCeiling.StatusCode);

        var overflow = await admin.PatchAsJsonAsync($"/api/admin/menu/items/{itemId}/stock",
            new { adjustBy = 1 });
        Assert.Equal(HttpStatusCode.BadRequest, overflow.StatusCode);

        // Running out is ordinary and still clamps rather than refusing.
        var runOut = await admin.PatchAsJsonAsync($"/api/admin/menu/items/{itemId}/stock",
            new { adjustBy = -MenuStockPolicy.MaximumStockQuantity });
        Assert.Equal(HttpStatusCode.OK, runOut.StatusCode);
    }

    // ---- helpers -------------------------------------------------------------------------------

    private async Task<(Guid RestaurantId, Guid ItemId)> SeedMenuAsync(string restaurantName, string itemName)
    {
        var restaurantId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var itemId = Guid.NewGuid();

        await _api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(new RestaurantEntity
            {
                Id = restaurantId,
                Name = restaurantName,
                Timezone = "Australia/Adelaide",
                IsActive = true,
                // Open around the clock. The entity default is 09:00-21:00, which made every cart
                // in this file depend on what time the suite happened to run: locally it passed in
                // the afternoon and CI answered 409 "outside opening hours" at 22:08 Adelaide. None
                // of these tests are about trading hours.
                OpeningHoursJson = AlwaysOpenHoursJson
            });
            db.MenuCategories.Add(new MenuCategory
            {
                Id = categoryId,
                RestaurantId = restaurantId,
                Name = "Mains",
                IsActive = true
            });
            db.MenuItems.Add(new MenuItem
            {
                Id = itemId,
                RestaurantId = restaurantId,
                CategoryId = categoryId,
                Name = itemName,
                Price = 12m,
                IsAvailable = true,
                IsSoldOut = false
            });
            await db.SaveChangesAsync();
        });

        return (restaurantId, itemId);
    }

    /// <summary>
    /// How many orders the guest lookup will hand back for this credential. The endpoint answers
    /// 200 with an empty list rather than 401 when it cannot prove the caller, so the count is the
    /// only thing that distinguishes a working credential from a dead one.
    /// </summary>
    private async Task<int> GuestLookupCount(Guid orderId, string? guestAccessToken)
    {
        var response = await _api.CreateClient().PostAsJsonAsync("/api/order/guest", new
        {
            orders = new[] { new { orderId, guestAccessToken } }
        });
        response.EnsureSuccessStatusCode();
        var rows = await response.Content.ReadFromJsonAsync<List<OrderRef>>();
        return rows?.Count ?? 0;
    }

    private static async Task<CheckoutPayload?> Checkout(HttpClient guest, Guid cartId)
    {
        var response = await guest.PostAsJsonAsync($"/api/public/carts/{cartId}/checkout", new
        {
            acceptedCustomerTermsVersion = "2026-08-08",
            acknowledgedPrivacyPolicyVersion = "2026-08-08",
            acknowledgedAllergenNoticeVersion = "2026-08-08"
        });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<CheckoutPayload>();
    }

    private sealed record JoinPayload(string ParticipantToken, CartRef Cart);

    private sealed record CartRef(Guid Id);

    private sealed record CheckoutPayload(OrderRef Order, string? GuestAccessToken);

    private sealed record OrderRef(Guid Id);
}
