using System.Net;
using System.Net.Http.Json;
using DineFlow.Infrastructure.Menu;
using DineFlow.Tests.Infrastructure;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// What a menu already on screen is told about what is left.
/// </summary>
/// <remarks>
/// <para>
/// A diner opens the menu, reads it, talks to the table, and orders ten minutes later. In between,
/// somebody else took the last portion — and the page went on offering it until the customer
/// happened to reload. Checkout does refuse, so nothing is oversold; being told at the till that
/// the dish you chose and configured was gone before you started is simply a bad way to find out.
/// </para>
/// <para>
/// Through the API, because most of what this endpoint does is decide which rows to leave out, and
/// leaving out the wrong ones is how a menu quietly starts crossing dishes off by itself.
/// </para>
/// </remarks>
public sealed class PublicMenuStockApiTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly Guid _restaurantId = Guid.NewGuid();

    private Guid _limitedItemId;
    private Guid _soldOutItemId;
    private Guid _unlimitedItemId;
    private Guid _withdrawnItemId;
    private Guid _hiddenCategoryItemId;
    private Guid _limitedOptionId;
    private Guid _withdrawnOptionId;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(new RestaurantEntity
            {
                Id = _restaurantId,
                Name = "Stock Kitchen",
                Currency = "aud",
                Timezone = "Australia/Adelaide",
                IsActive = true,
            });

            var onMenu = new MenuCategory
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                Name = "Sides",
                IsActive = true,
            };
            var takenOff = new MenuCategory
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                Name = "Christmas menu",
                IsActive = false,
            };
            context.MenuCategories.AddRange(onMenu, takenOff);

            var limited = Item(onMenu.Id, "Garlic Bread", stock: 3);
            var soldOut = Item(onMenu.Id, "Daily Soup", stock: 0, isSoldOut: true);
            var unlimited = Item(onMenu.Id, "Table Water", stock: null);
            var withdrawn = Item(onMenu.Id, "Off today", stock: 5, isAvailable: false);
            var hidden = Item(takenOff.Id, "Pudding", stock: 5);

            _limitedItemId = limited.Id;
            _soldOutItemId = soldOut.Id;
            _unlimitedItemId = unlimited.Id;
            _withdrawnItemId = withdrawn.Id;
            _hiddenCategoryItemId = hidden.Id;

            context.MenuItems.AddRange(limited, soldOut, unlimited, withdrawn, hidden);

            var group = new MenuItemOptionGroup
            {
                Id = Guid.NewGuid(),
                MenuItemId = limited.Id,
                RestaurantId = _restaurantId,
                Name = "Finish",
                IsActive = true,
            };
            context.MenuItemOptionGroups.Add(group);

            var limitedOption = Option(group, limited.Id, "Extra mozzarella", stock: 2);
            var withdrawnOption = Option(group, limited.Id, "Truffle", stock: 2, isAvailable: false);
            _limitedOptionId = limitedOption.Id;
            _withdrawnOptionId = withdrawnOption.Id;

            context.MenuItemOptions.AddRange(limitedOption, withdrawnOption);
            await context.SaveChangesAsync();
        });
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private MenuItem Item(
        Guid categoryId,
        string name,
        int? stock,
        bool isSoldOut = false,
        bool isAvailable = true) => new()
    {
        Id = Guid.NewGuid(),
        RestaurantId = _restaurantId,
        CategoryId = categoryId,
        Name = name,
        Price = 8.5m,
        StockQuantity = stock,
        IsSoldOut = isSoldOut,
        IsAvailable = isAvailable,
    };

    private MenuItemOption Option(
        MenuItemOptionGroup group,
        Guid menuItemId,
        string name,
        int? stock,
        bool isAvailable = true) => new()
    {
        Id = Guid.NewGuid(),
        GroupId = group.Id,
        MenuItemId = menuItemId,
        RestaurantId = _restaurantId,
        Name = name,
        StockQuantity = stock,
        IsAvailable = isAvailable,
    };

    private sealed record StockItem(Guid Id, bool IsSoldOut, int? RemainingStock);

    private sealed record StockOption(Guid Id, int? RemainingStock);

    private sealed record StockResponse(Guid RestaurantId, StockItem[] Items, StockOption[] Options);

    private async Task<StockResponse> ReadAsync()
    {
        var response = await _api.CreateClient()
            .GetAsync($"/api/public/menu/restaurants/{_restaurantId}/stock");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<StockResponse>())!;
    }

    [RequiresPostgresFact]
    public async Task ItPublishesWhatIsLeftOfEveryLimitedDish()
    {
        var stock = await ReadAsync();

        Assert.Equal(3, Assert.Single(stock.Items, item => item.Id == _limitedItemId).RemainingStock);
    }

    /// <summary>
    /// A sold-out dish is still listed. The page has it on screen and needs to be told to cross it
    /// out; leaving it out of the reading would say nothing at all about it.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ASoldOutDishIsListedRatherThanOmitted()
    {
        var soldOut = Assert.Single((await ReadAsync()).Items, item => item.Id == _soldOutItemId);

        Assert.True(soldOut.IsSoldOut);
        // No count beside a sold-out badge: a kitchen that has stopped a dish still has portions,
        // and saying both would contradict itself.
        Assert.Null(soldOut.RemainingStock);
    }

    [RequiresPostgresFact]
    public async Task AnUnlimitedDishSaysNothingAboutItsSupply()
    {
        var unlimited = Assert.Single((await ReadAsync()).Items, item => item.Id == _unlimitedItemId);

        Assert.False(unlimited.IsSoldOut);
        Assert.Null(unlimited.RemainingStock);
    }

    /// <summary>
    /// The same rows the full menu leaves out, so a page merging this cannot end up believing in a
    /// dish the menu never showed it.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ItLeavesOutWhatTheMenuItselfLeavesOut()
    {
        var stock = await ReadAsync();

        Assert.DoesNotContain(stock.Items, item => item.Id == _withdrawnItemId);
        Assert.DoesNotContain(stock.Items, item => item.Id == _hiddenCategoryItemId);
        Assert.DoesNotContain(stock.Options, option => option.Id == _withdrawnOptionId);
    }

    [RequiresPostgresFact]
    public async Task ItFollowsModifiersToo()
    {
        var option = Assert.Single((await ReadAsync()).Options, item => item.Id == _limitedOptionId);

        Assert.Equal(2, option.RemainingStock);
    }

    [RequiresPostgresFact]
    public async Task AnUnknownRestaurantIsNotOrderableFrom()
    {
        var response = await _api.CreateClient()
            .GetAsync($"/api/public/menu/restaurants/{Guid.NewGuid()}/stock");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>Anyone reading a menu can read this; there is no cart and no account involved.</summary>
    [RequiresPostgresFact]
    public async Task ADinerNeedsNoAccountToSeeIt()
    {
        var response = await _api.CreateClient()
            .GetAsync($"/api/public/menu/restaurants/{_restaurantId}/stock");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
