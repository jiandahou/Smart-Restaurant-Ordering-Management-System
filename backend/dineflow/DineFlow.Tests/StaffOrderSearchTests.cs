using DineFlow.Api.Services;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// What the staff order search actually searches.
/// </summary>
/// <remarks>
/// <para>
/// The box says "Order, pickup, customer, table, or item" and the query looked at everything on that
/// list except the customer. Searching "Customer One" returned nothing while seven of that
/// restaurant's orders were theirs — an answer indistinguishable from "that customer has never
/// ordered here", which is what staff would have concluded.
/// </para>
/// <para>
/// Run against PostgreSQL because the search is <c>ILIKE</c> with an escape character, and neither
/// the case-insensitivity nor the escaping exists in an in-memory provider.
/// </para>
/// </remarks>
public sealed class StaffOrderSearchTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private Guid _restaurantId;
    private Guid _otherRestaurantId;

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
            new RestaurantEntity
            {
                Id = _restaurantId,
                Name = "Search Kitchen",
                Currency = "aud",
                Timezone = "Australia/Sydney",
                IsActive = true
            },
            new RestaurantEntity
            {
                Id = _otherRestaurantId,
                Name = "Someone Else's Kitchen",
                Currency = "aud",
                Timezone = "Australia/Sydney",
                IsActive = true
            });

        var ours = new ApplicationUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = "customer.one@dineflow.test",
            NormalizedUserName = "CUSTOMER.ONE@DINEFLOW.TEST",
            Email = "customer.one@dineflow.test",
            NormalizedEmail = "CUSTOMER.ONE@DINEFLOW.TEST",
            FullName = "Customer One"
        };
        var theirs = new ApplicationUser
        {
            Id = Guid.NewGuid().ToString(),
            UserName = "customer.two@dineflow.test",
            NormalizedUserName = "CUSTOMER.TWO@DINEFLOW.TEST",
            Email = "customer.two@dineflow.test",
            NormalizedEmail = "CUSTOMER.TWO@DINEFLOW.TEST",
            FullName = "Customer Two"
        };
        context.Users.AddRange(ours, theirs);

        context.Orders.AddRange(
            Order("ORD-SEARCH-1", _restaurantId, ours.Id),
            Order("ORD-SEARCH-2", _restaurantId, ours.Id),
            Order("ORD-SEARCH-3", _restaurantId, null),
            // The same customer at another restaurant. Staff here must never see it.
            Order("ORD-SEARCH-4", _otherRestaurantId, ours.Id),
            Order("ORD-SEARCH-5", _restaurantId, theirs.Id));

        await context.SaveChangesAsync();
    }

    private static Order Order(string number, Guid restaurantId, string? customerId) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = restaurantId,
        CustomerId = customerId,
        OrderNumber = number,
        Status = OrderStatus.Pending,
        PaymentStatus = PaymentStatus.Paid,
        PaymentMethod = PaymentMethod.Online,
        TotalAmount = 10m
    };

    public Task DisposeAsync() => _database.DisposeAsync();

    /// <summary>The very query the controller runs, scoped to this restaurant as it is there.</summary>
    private IQueryable<Order> Search(AppDbContext context, string search) =>
        context.Orders
            .AsNoTracking()
            .Where(order => order.RestaurantId == _restaurantId)
            .Where(StaffOrderSearch.Predicate(search));

    [RequiresPostgresFact]
    public async Task FindsOrdersByCustomerName()
    {
        await using var context = _database.CreateContext();

        var found = await Search(context, "Customer One")
            .Select(order => order.OrderNumber)
            .OrderBy(number => number)
            .ToListAsync();

        Assert.Equal(["ORD-SEARCH-1", "ORD-SEARCH-2"], found);
    }

    /// <summary>Staff are shown the email on every order here, so they can search by it too.</summary>
    [RequiresPostgresFact]
    public async Task FindsOrdersByCustomerEmail()
    {
        await using var context = _database.CreateContext();

        var found = await Search(context, "customer.one@dineflow.test").CountAsync();

        Assert.Equal(2, found);
    }

    /// <summary>Typing a name is not a way to look into another restaurant's orders.</summary>
    [RequiresPostgresFact]
    public async Task NeverReachesAnotherRestaurantsOrders()
    {
        await using var context = _database.CreateContext();

        var found = await Search(context, "Customer One")
            .Select(order => order.OrderNumber)
            .ToListAsync();

        Assert.DoesNotContain("ORD-SEARCH-4", found);
    }

    [RequiresPostgresFact]
    public async Task MatchesRegardlessOfCase()
    {
        await using var context = _database.CreateContext();

        Assert.Equal(2, await Search(context, "cUsToMeR oNe").CountAsync());
    }

    /// <summary>
    /// A guest order has no customer at all, and must not fall over or be swept in by a name search.
    /// </summary>
    [RequiresPostgresFact]
    public async Task LeavesGuestOrdersOutOfANameSearch()
    {
        await using var context = _database.CreateContext();

        var found = await Search(context, "Customer")
            .Select(order => order.OrderNumber)
            .ToListAsync();

        Assert.DoesNotContain("ORD-SEARCH-3", found);
        Assert.Contains("ORD-SEARCH-5", found);
    }

    /// <summary>
    /// The wildcards belong to LIKE, not to whoever is typing: <c>%</c> must find a literal percent
    /// sign rather than returning every order in the restaurant.
    /// </summary>
    [RequiresPostgresFact]
    public async Task DoesNotHandTheTypistTheWildcards()
    {
        await using var context = _database.CreateContext();

        Assert.Equal(0, await Search(context, "%").CountAsync());
        Assert.Equal(0, await Search(context, "_").CountAsync());
    }
}
