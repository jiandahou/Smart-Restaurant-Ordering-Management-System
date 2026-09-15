using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// Pure-policy regression for AUDIT-04: the front counter must be able to record a corrected
/// payment on a completed order whose earlier counter payment was voided.
/// </summary>
public sealed class FrontCounterOrderPolicyAuditTests
{
    [Fact]
    public void CompletedOrder_WithCounterPaymentDue_CanBeRecorded()
    {
        // A completed pay-at-counter order whose payment was voided is back to Unpaid: money is
        // still owed and the till must be able to take it (AUDIT-04).
        Assert.True(FrontCounterOrderPolicy.CanRecordCounterPayment(
            OrderStatus.Completed, PaymentMethod.PayAtCounter, PaymentStatus.Unpaid));
    }

    [Fact]
    public void CompletedOrder_AlreadyPaid_CannotBeRecordedAgain()
    {
        // Nothing is due, so removing the blanket "not Completed" rule must not let it be charged twice.
        Assert.False(FrontCounterOrderPolicy.CanRecordCounterPayment(
            OrderStatus.Completed, PaymentMethod.PayAtCounter, PaymentStatus.Paid));
    }

    [Theory]
    [InlineData(OrderStatus.Cancelled)]
    [InlineData(OrderStatus.Rejected)]
    public void CancelledOrRejectedOrder_IsNeverChargeable(OrderStatus status)
    {
        Assert.False(FrontCounterOrderPolicy.CanRecordCounterPayment(
            status, PaymentMethod.PayAtCounter, PaymentStatus.Unpaid));
    }
}

/// <summary>
/// End-to-end regressions for the account-revocation, tenant-isolation, retired-endpoint,
/// menu-visibility and option-group-validation fixes, exercised over HTTP against a throwaway
/// PostgreSQL database the same way the clients call them.
/// </summary>
public sealed class AuditFixesApiTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    public Task InitializeAsync() => _api.InitializeAsync();

    public Task DisposeAsync() => _api.DisposeAsync();

    private async Task<Guid> SeedRestaurantAsync(string name, bool isActive = true)
    {
        var id = Guid.NewGuid();
        await _api.UseDbAsync(async db =>
        {
            db.Restaurants.Add(new RestaurantEntity
            {
                Id = id,
                Name = name,
                Timezone = "Australia/Adelaide",
                IsActive = isActive
            });
            await db.SaveChangesAsync();
        });
        return id;
    }

    private async Task<string> UserIdAsync(string email)
    {
        using var scope = _api.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email);
        Assert.NotNull(user);
        return user!.Id;
    }

    // ---- AUDIT-01: disabling an account ends its live sessions ---------------------------------

    [RequiresPostgresFact]
    public async Task DisablingAnAccount_RejectsItsExistingAccessToken()
    {
        var restaurantId = await SeedRestaurantAsync("Revocation Kitchen A");
        const string email = "audit01-admin@dineflow.test";
        var admin = await _api.SignInAsAsync(email, ApplicationRoles.Admin, restaurantId);

        // The token works before the account is touched.
        var before = await admin.GetAsync($"/api/admin/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        var owner = await _api.SignInAsAsync(DineFlowApiFactory.OwnerEmail, ApplicationRoles.PlatformOwner);
        var disable = await owner.PatchAsJsonAsync(
            $"/api/users/{await UserIdAsync(email)}/status",
            new { isDisabled = true });
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);

        // The same access token must now be refused rather than staying valid until it expires.
        var after = await admin.GetAsync($"/api/admin/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);
    }

    // ---- AUDIT-02: demoting an account drops its old role immediately --------------------------

    [RequiresPostgresFact]
    public async Task DemotingAnAdmin_RejectsTheOldAdminTokenAndLimitsTheNewOne()
    {
        var restaurantId = await SeedRestaurantAsync("Revocation Kitchen B");
        const string email = "audit02-admin@dineflow.test";
        var admin = await _api.SignInAsAsync(email, ApplicationRoles.Admin, restaurantId);

        var before = await admin.GetAsync($"/api/admin/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        var owner = await _api.SignInAsAsync(DineFlowApiFactory.OwnerEmail, ApplicationRoles.PlatformOwner);
        var demote = await owner.PutAsJsonAsync(
            $"/api/users/{await UserIdAsync(email)}",
            new { role = ApplicationRoles.Staff, restaurantId });
        Assert.Equal(HttpStatusCode.OK, demote.StatusCode);

        // The old Admin token must not keep Admin powers after the demotion.
        var oldToken = await admin.GetAsync($"/api/admin/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.Unauthorized, oldToken.StatusCode);

        // A fresh sign-in gets the new, lower role, which the admin endpoint refuses.
        var staff = await _api.SignInAsAsync(email, ApplicationRoles.Staff, restaurantId);
        var newToken = await staff.GetAsync($"/api/admin/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.Forbidden, newToken.StatusCode);
    }

    // ---- AUDIT-07: legacy order endpoints are tenant-scoped / retired --------------------------

    [RequiresPostgresFact]
    public async Task LegacyOrderDetail_HidesAnotherRestaurantsOrder()
    {
        var restaurantA = await SeedRestaurantAsync("Legacy Read A");
        var restaurantB = await SeedRestaurantAsync("Legacy Read B");

        var orderInB = Guid.NewGuid();
        await _api.UseDbAsync(async db =>
        {
            db.Orders.Add(new Order
            {
                Id = orderInB,
                RestaurantId = restaurantB,
                OrderNumber = "AUDIT07-B",
                TotalAmount = 10m
            });
            await db.SaveChangesAsync();
        });

        var adminA = await _api.SignInAsAsync("audit07-admin-a@dineflow.test", ApplicationRoles.Admin, restaurantA);
        var adminB = await _api.SignInAsAsync("audit07-admin-b@dineflow.test", ApplicationRoles.Admin, restaurantB);

        var ownTenant = await adminB.GetAsync($"/api/order/{orderInB}");
        Assert.Equal(HttpStatusCode.OK, ownTenant.StatusCode);

        var crossTenant = await adminA.GetAsync($"/api/order/{orderInB}");
        Assert.Equal(HttpStatusCode.NotFound, crossTenant.StatusCode);
    }

    [RequiresPostgresFact]
    public async Task LegacyOrderWriteEndpoints_AreRetired()
    {
        var restaurantId = await SeedRestaurantAsync("Legacy Write A");
        var admin = await _api.SignInAsAsync("audit07-write@dineflow.test", ApplicationRoles.Admin, restaurantId);
        var id = Guid.NewGuid();

        var create = await admin.PostAsJsonAsync("/api/order", new { });
        Assert.Equal(HttpStatusCode.Gone, create.StatusCode);

        var update = await admin.PutAsJsonAsync($"/api/order/{id}", new { });
        Assert.Equal(HttpStatusCode.Gone, update.StatusCode);

        var status = await admin.PutAsJsonAsync($"/api/order/{id}/status", new { });
        Assert.Equal(HttpStatusCode.Gone, status.StatusCode);

        var delete = await admin.DeleteAsync($"/api/order/{id}");
        Assert.Equal(HttpStatusCode.Gone, delete.StatusCode);
    }

    // ---- AUDIT-06: legacy anonymous menu endpoints honour deactivation -------------------------

    [RequiresPostgresFact]
    public async Task LegacyMenuList_And_Search_ExcludeItemsUnderAnInactiveCategory()
    {
        var restaurantId = await SeedRestaurantAsync("Menu Visibility Kitchen");
        var uniqueName = "HiddenDish-" + Guid.NewGuid().ToString("N");
        await _api.UseDbAsync(async db =>
        {
            var categoryId = Guid.NewGuid();
            db.MenuCategories.Add(new MenuCategory
            {
                Id = categoryId,
                RestaurantId = restaurantId,
                Name = "Retired Section",
                IsActive = false
            });
            db.MenuItems.Add(new MenuItem
            {
                Id = Guid.NewGuid(),
                RestaurantId = restaurantId,
                CategoryId = categoryId,
                Name = uniqueName,
                Price = 10m,
                IsAvailable = true,
                IsSoldOut = false
            });
            await db.SaveChangesAsync();
        });

        var anonymous = _api.CreateClient();

        var list = await anonymous.GetStringAsync($"/api/menu/items?restaurantId={restaurantId}");
        Assert.DoesNotContain(uniqueName, list);

        var search = await anonymous.GetStringAsync(
            $"/api/menu/items/search?restaurantId={restaurantId}&q={uniqueName}");
        Assert.DoesNotContain(uniqueName, search);
    }

    [RequiresPostgresFact]
    public async Task LegacyMenuCategories_HideAnInactiveRestaurant()
    {
        var restaurantId = await SeedRestaurantAsync("Closed Kitchen", isActive: false);
        var anonymous = _api.CreateClient();

        var response = await anonymous.GetAsync($"/api/menu/categories?restaurantId={restaurantId}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- Option group blank-name validation (MENU-OPT-02/21) -----------------------------------

    [RequiresPostgresFact]
    public async Task CreatingAnOptionGroup_WithABlankName_IsRejected()
    {
        var restaurantId = await SeedRestaurantAsync("Option Group Kitchen");
        var itemId = Guid.NewGuid();
        await _api.UseDbAsync(async db =>
        {
            var categoryId = Guid.NewGuid();
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
                Name = "Configurable Dish",
                Price = 12m,
                IsAvailable = true,
                IsSoldOut = false
            });
            await db.SaveChangesAsync();
        });

        var admin = await _api.SignInAsAsync("optgroup-admin@dineflow.test", ApplicationRoles.Admin, restaurantId);

        var whitespace = await admin.PostAsJsonAsync(
            $"/api/menu/items/{itemId}/option-groups",
            new { name = "   ", isRequired = false, minSelections = 0, maxSelections = 1, displayOrder = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, whitespace.StatusCode);

        // A real name is still accepted, and stored trimmed.
        var valid = await admin.PostAsJsonAsync(
            $"/api/menu/items/{itemId}/option-groups",
            new { name = "  Size  ", isRequired = false, minSelections = 0, maxSelections = 1, displayOrder = 0 });
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
    }
}
