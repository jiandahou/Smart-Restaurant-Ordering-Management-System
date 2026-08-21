using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Stock on a modifier, not just on the dish.
/// </summary>
/// <remarks>
/// <para>
/// A dish could run out and a modifier could not: the last of the day's truffle, a sauce made in one
/// batch, sold on indefinitely because the only thing being counted was the plate. The kitchen found
/// out at the pass, one ticket at a time.
/// </para>
/// <para>
/// Run against PostgreSQL because the reservation is a single guarded UPDATE — the whole point is
/// that two checkouts at once cannot both take the last one, and no in-memory provider can show that.
/// </para>
/// </remarks>
public sealed class MenuItemOptionStockTests : IAsyncLifetime
{
    private readonly PostgresTestDatabase _database = new();
    private readonly Guid _restaurantId = Guid.NewGuid();
    private Guid _trackedOptionId;
    private Guid _untrackedOptionId;

    public async Task InitializeAsync()
    {
        await _database.InitializeAsync();
        if (_database.ConnectionString is null)
        {
            return;
        }

        await using var context = _database.CreateContext();

        context.Restaurants.Add(new RestaurantEntity
        {
            Id = _restaurantId,
            Name = "Option Stock Kitchen",
            Currency = "aud",
            Timezone = "Australia/Sydney",
            IsActive = true
        });

        var category = new MenuCategory
        {
            Id = Guid.NewGuid(),
            RestaurantId = _restaurantId,
            Name = "Sides"
        };
        var item = new MenuItem
        {
            Id = Guid.NewGuid(),
            RestaurantId = _restaurantId,
            CategoryId = category.Id,
            Name = "Garlic Bread",
            Price = 8m,
            StockQuantity = 10
        };
        var group = new MenuItemOptionGroup
        {
            Id = Guid.NewGuid(),
            MenuItemId = item.Id,
            RestaurantId = _restaurantId,
            Name = "Finish",
            IsRequired = false,
            MinSelections = 0,
            MaxSelections = 2
        };

        var tracked = new MenuItemOption
        {
            Id = Guid.NewGuid(),
            GroupId = group.Id,
            MenuItemId = item.Id,
            RestaurantId = _restaurantId,
            Name = "Truffle shavings",
            MaxQuantity = 2,
            StockQuantity = 3
        };
        _trackedOptionId = tracked.Id;

        var untracked = new MenuItemOption
        {
            Id = Guid.NewGuid(),
            GroupId = group.Id,
            MenuItemId = item.Id,
            RestaurantId = _restaurantId,
            Name = "Chilli flakes",
            MaxQuantity = 1,
            StockQuantity = null
        };
        _untrackedOptionId = untracked.Id;

        context.MenuCategories.Add(category);
        context.MenuItems.Add(item);
        context.MenuItemOptionGroups.Add(group);
        context.MenuItemOptions.AddRange(tracked, untracked);
        await context.SaveChangesAsync();
    }

    public Task DisposeAsync() => _database.DisposeAsync();

    private async Task<int?> RemainingAsync(Guid optionId)
    {
        await using var context = _database.CreateContext();
        return await context.MenuItemOptions
            .AsNoTracking()
            .Where(option => option.Id == optionId)
            .Select(option => option.StockQuantity)
            .SingleAsync();
    }

    private async Task<IReadOnlyList<Guid>> ReserveAsync(Guid optionId, int quantity)
    {
        await using var context = _database.CreateContext();
        var service = new MenuItemStockService(context);
        return await service.TryReserveOptionsAsync(
            new Dictionary<Guid, int> { [optionId] = quantity },
            CancellationToken.None);
    }

    [RequiresPostgresFact]
    public async Task TakesTheUnitsAsked()
    {
        Assert.Empty(await ReserveAsync(_trackedOptionId, 2));

        Assert.Equal(1, await RemainingAsync(_trackedOptionId));
    }

    /// <summary>Asking for more than is left takes nothing at all.</summary>
    [RequiresPostgresFact]
    public async Task RefusesMoreThanIsLeftAndLeavesTheCountAlone()
    {
        var unavailable = await ReserveAsync(_trackedOptionId, 4);

        Assert.Equal(_trackedOptionId, Assert.Single(unavailable));
        Assert.Equal(3, await RemainingAsync(_trackedOptionId));
    }

    /// <summary>Most modifiers are unlimited and must not be made to carry a count.</summary>
    [RequiresPostgresFact]
    public async Task LeavesAnUntrackedModifierAlone()
    {
        Assert.Empty(await ReserveAsync(_untrackedOptionId, 99));

        Assert.Null(await RemainingAsync(_untrackedOptionId));
    }

    /// <summary>
    /// Two checkouts at the same moment. Three left, two each — one of them has to be turned away.
    /// </summary>
    [RequiresPostgresFact]
    public async Task OnlyOneOfTwoSimultaneousOrdersGetsTheLastOnes()
    {
        var results = await Task.WhenAll(
            ReserveAsync(_trackedOptionId, 2),
            ReserveAsync(_trackedOptionId, 2));

        Assert.Equal(1, results.Count(result => result.Count == 0));
        // Three minus one successful pair. Two successes would have left it at −1.
        Assert.Equal(1, await RemainingAsync(_trackedOptionId));
    }

    [RequiresPostgresFact]
    public async Task GivesTheUnitsBackWhenAnOrderIsCalledOff()
    {
        await ReserveAsync(_trackedOptionId, 2);

        await using (var context = _database.CreateContext())
        {
            await new MenuItemStockService(context).ReleaseOptionsAsync(
                new Dictionary<Guid, int> { [_trackedOptionId] = 2 },
                CancellationToken.None);
        }

        Assert.Equal(3, await RemainingAsync(_trackedOptionId));
    }

    /// <summary>
    /// The multiplication, which is the whole difficulty.
    /// </summary>
    /// <remarks>
    /// Two breads each taking three shavings is six, not two and not three. Counted unmultiplied, a
    /// tracked modifier oversells while every line on the order reads correctly on its own — the
    /// hardest kind of shortage to explain afterwards.
    /// </remarks>
    [Fact]
    public void CountsModifiersPerDishTimesPerItem()
    {
        var optionId = Guid.NewGuid();
        var orderItems = new[]
        {
            new OrderItem
            {
                Quantity = 2,
                SelectedOptions =
                [
                    new OrderItemOption { MenuItemOptionId = optionId, Quantity = 3 }
                ]
            }
        };

        var quantities = OrderOptionStock.RequestedQuantities(orderItems);

        Assert.Equal(6, quantities[optionId]);
    }

    /// <summary>The same modifier on two lines of one order adds up.</summary>
    [Fact]
    public void AddsUpTheSameModifierAcrossLines()
    {
        var optionId = Guid.NewGuid();
        var orderItems = new[]
        {
            new OrderItem { Quantity = 1, SelectedOptions = [new OrderItemOption { MenuItemOptionId = optionId, Quantity = 2 }] },
            new OrderItem { Quantity = 3, SelectedOptions = [new OrderItemOption { MenuItemOptionId = optionId, Quantity = 1 }] }
        };

        Assert.Equal(5, OrderOptionStock.RequestedQuantities(orderItems)[optionId]);
    }

    /// <summary>An option with no menu id behind it is a snapshot of something deleted; skip it.</summary>
    [Fact]
    public void IgnoresAModifierThatNoLongerExists()
    {
        var orderItems = new[]
        {
            new OrderItem { Quantity = 2, SelectedOptions = [new OrderItemOption { MenuItemOptionId = null, Quantity = 3 }] }
        };

        Assert.Empty(OrderOptionStock.RequestedQuantities(orderItems));
    }
}
