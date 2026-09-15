using DineFlow.Api.Contracts.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using DineFlow.Api.Services;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/public/menu")]
public class PublicMenuController(AppDbContext dbContext) : ControllerBase
{
    /// <summary>
    /// What is left, for a menu that is already on screen.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A diner opens the menu, reads it, talks to the people at the table, and orders ten minutes
    /// later. In between, somebody else took the last portion. The page went on offering it, and
    /// the only correction came at checkout — which does refuse, so nothing is oversold, but a
    /// customer who has chosen a dish and picked its options should not be told at the till that it
    /// was gone before they started.
    /// </para>
    /// <para>
    /// Deliberately not the whole menu on a timer. Descriptions, allergen statements and option
    /// groups do not change during service; sending them to every phone in the room every few
    /// seconds to discover that would be the cost of a real-time menu without the benefit.
    /// </para>
    /// <para>
    /// Sold-out dishes are still listed rather than omitted, because the page has them on screen
    /// and needs to be told to cross them out. Only unavailable ones — the ones the menu never
    /// showed — are left out, which is the same set the full menu leaves out.
    /// </para>
    /// </remarks>
    [HttpGet("restaurants/{restaurantId:guid}/stock")]
    public async Task<IActionResult> GetRestaurantMenuStock(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var restaurantIsActive = await dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(
                restaurant => restaurant.Id == restaurantId && restaurant.IsActive,
                cancellationToken);

        if (!restaurantIsActive)
        {
            return NotFound(new { message = "Restaurant is not available for ordering." });
        }

        var items = await dbContext.MenuItems
            .AsNoTracking()
            .Where(item =>
                item.RestaurantId == restaurantId &&
                item.IsAvailable &&
                item.Category!.IsActive)
            .Select(item => new PublicMenuItemStock
            {
                Id = item.Id,
                IsSoldOut = item.IsSoldOut,
                // Carried raw and resolved below, so the rule about what a customer may see stays
                // in one place and cannot drift from the full menu's answer.
                RemainingStock = item.StockQuantity,
            })
            .ToListAsync(cancellationToken);

        foreach (var item in items)
        {
            item.RemainingStock = PublicStockDisclosure.RemainingToPublish(
                item.RemainingStock,
                item.IsSoldOut);
        }

        var options = await dbContext.MenuItemOptions
            .AsNoTracking()
            .Where(option =>
                option.IsAvailable &&
                option.Group!.IsActive &&
                option.Group.MenuItem!.RestaurantId == restaurantId &&
                option.Group.MenuItem.IsAvailable)
            .Select(option => new PublicMenuOptionStock
            {
                Id = option.Id,
                RemainingStock = option.StockQuantity,
            })
            .ToListAsync(cancellationToken);

        return Ok(new PublicMenuStockResponse
        {
            RestaurantId = restaurantId,
            Items = items,
            Options = options,
        });
    }

    [HttpGet("restaurants/{restaurantId:guid}")]
    public async Task<IActionResult> GetRestaurantMenu(
        Guid restaurantId,
        [FromQuery] string? search,
        [FromQuery(Name = "q")] string? query,
        CancellationToken cancellationToken)
    {
        var restaurantIsActive = await dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(
                restaurant => restaurant.Id == restaurantId && restaurant.IsActive,
                cancellationToken);

        if (!restaurantIsActive)
        {
            return NotFound(new { message = "Restaurant is not available for ordering." });
        }

        var searchTerm = string.IsNullOrWhiteSpace(search)
            ? query?.Trim()
            : search.Trim();

        if (searchTerm?.Length > 120)
        {
            return BadRequest(new { message = "Search cannot exceed 120 characters." });
        }

        var searchPattern = string.IsNullOrWhiteSpace(searchTerm) ? null : SearchPattern.Contains(searchTerm);
        var categoriesQuery = dbContext.MenuCategories
            .AsNoTracking()
            .Where(category => category.RestaurantId == restaurantId && category.IsActive);

        if (searchPattern is not null)
        {
            categoriesQuery = categoriesQuery.Where(category => category.MenuItems.Any(item =>
                item.RestaurantId == restaurantId &&
                item.IsAvailable &&
                (
                    EF.Functions.ILike(item.Name, searchPattern, SearchPattern.EscapeCharacter) ||
                    (item.Description != null && EF.Functions.ILike(item.Description, searchPattern, SearchPattern.EscapeCharacter)) ||
                    item.OptionGroups.Any(group =>
                        group.IsActive &&
                        (
                            EF.Functions.ILike(group.Name, searchPattern, SearchPattern.EscapeCharacter) ||
                            group.Options.Any(option =>
                                option.IsAvailable &&
                                EF.Functions.ILike(option.Name, searchPattern, SearchPattern.EscapeCharacter))
                        ))
                )));
        }

        var categories = await categoriesQuery
            .OrderBy(category => category.DisplayOrder)
            .ThenBy(category => category.Name)
            .Select(category => new PublicMenuCategoryResponse
            {
                Id = category.Id,
                Name = category.Name,
                Description = category.Description,
                DisplayOrder = category.DisplayOrder,
                Items = category.MenuItems
                    .Where(item =>
                        item.RestaurantId == restaurantId &&
                        item.IsAvailable &&
                        (searchPattern == null ||
                            EF.Functions.ILike(item.Name, searchPattern, SearchPattern.EscapeCharacter) ||
                            (item.Description != null && EF.Functions.ILike(item.Description, searchPattern, SearchPattern.EscapeCharacter)) ||
                            item.OptionGroups.Any(group =>
                                group.IsActive &&
                                (
                                    EF.Functions.ILike(group.Name, searchPattern, SearchPattern.EscapeCharacter) ||
                                    group.Options.Any(option =>
                                        option.IsAvailable &&
                                        EF.Functions.ILike(option.Name, searchPattern, SearchPattern.EscapeCharacter))
                                ))))
                    .OrderBy(item => item.DisplayOrder)
                    .ThenBy(item => item.Name)
                    .Select(item => new PublicMenuItemResponse
                    {
                        Id = item.Id,
                        CategoryId = item.CategoryId,
                        Name = item.Name,
                        Description = item.Description,
                        Price = item.Price,
                        ImageUrl = item.ImageUrl,
                        IsAvailable = item.IsAvailable,
                        IsSoldOut = item.IsSoldOut,
                        StockQuantity = item.StockQuantity,
                        IsVegetarian = item.IsVegetarian,
                        IsVegan = item.IsVegan,
                        IsGlutenFree = item.IsGlutenFree,
                        IsHalal = item.IsHalal,
                        Allergens = item.Allergens,
                        MayContainAllergens = item.MayContainAllergens,
                        CrossContactStatement = item.CrossContactStatement,
                        AllergenInfoLastVerifiedAt = item.AllergenInfoLastVerifiedAt,
                        SpiceLevel = item.SpiceLevel,
                        ServingSize = item.ServingSize,
                        Calories = item.Calories,
                        IsPopular = item.IsPopular,
                        IsRecommended = item.IsRecommended,
                        DisplayOrder = item.DisplayOrder,
                        OptionGroups = item.OptionGroups
                            .Where(group => group.IsActive)
                            .OrderBy(group => group.DisplayOrder)
                            .ThenBy(group => group.Name)
                            .Select(group => new MenuOptionGroupResponse
                            {
                                Id = group.Id,
                                MenuItemId = group.MenuItemId,
                                Name = group.Name,
                                IsRequired = group.IsRequired,
                                MinSelections = group.MinSelections,
                                MaxSelections = group.MaxSelections,
                                DisplayOrder = group.DisplayOrder,
                                IsActive = group.IsActive,
                                CreatedAt = group.CreatedAt,
                                UpdatedAt = group.UpdatedAt,
                                Options = group.Options
                                    .Where(option => option.IsAvailable)
                                    .OrderBy(option => option.DisplayOrder)
                                    .ThenBy(option => option.Name)
                                    .Select(option => new MenuOptionResponse
                                    {
                                        Id = option.Id,
                                        GroupId = option.GroupId,
                                        Name = option.Name,
                                        PriceAdjustment = option.PriceAdjustment,
                                        AdjustmentType = (int)option.AdjustmentType,
                                        MaxQuantity = option.MaxQuantity,
                                        RemainingStock = option.StockQuantity,
                                        DisplayOrder = option.DisplayOrder,
                                        Allergens = option.Allergens,
                                        MayContainAllergens = option.MayContainAllergens,
                                        CrossContactStatement = option.CrossContactStatement,
                                        IsAvailable = option.IsAvailable,
                                        CreatedAt = option.CreatedAt,
                                        UpdatedAt = option.UpdatedAt
                                    })
                                    .ToList()
                            })
                            .ToList()
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        // Applied here rather than inside the query so the rule about what a customer may see lives
        // in one place, expressed once, instead of as a condition SQL happens to be able to translate.
        foreach (var item in categories.SelectMany(category => category.Items))
        {
            item.RemainingStock = PublicStockDisclosure.RemainingToPublish(item.StockQuantity, item.IsSoldOut);
        }

        return Ok(new PublicMenuResponse
        {
            RestaurantId = restaurantId,
            Categories = categories
        });
    }
}
