using System.Text.Json.Serialization;

namespace DineFlow.Api.Contracts.Menu;

public sealed class PublicMenuResponse
{
    public Guid RestaurantId { get; init; }

    public required IReadOnlyList<PublicMenuCategoryResponse> Categories { get; init; }
}

public sealed class PublicMenuCategoryResponse
{
    public Guid Id { get; init; }

    public required string Name { get; init; }

    public string? Description { get; init; }

    public int DisplayOrder { get; init; }

    public required IReadOnlyList<PublicMenuItemResponse> Items { get; init; }
}

public sealed class PublicMenuItemResponse
{
    public Guid Id { get; init; }

    public Guid CategoryId { get; init; }

    public required string Name { get; init; }

    public string? Description { get; init; }

    public decimal Price { get; init; }

    public string? ImageUrl { get; init; }

    public bool IsAvailable { get; init; }

    public bool IsSoldOut { get; init; }

    /// <summary>
    /// The tracked count, used only to work out what may be published. Never sent to a browser:
    /// the full number is the restaurant's trade, not the customer's business.
    /// </summary>
    [JsonIgnore]
    public int? StockQuantity { get; init; }

    /// <summary>
    /// Portions left, once few enough to be worth warning about. Null when the dish is unlimited,
    /// comfortably stocked, or already sold out — in each case there is nothing useful to say.
    /// </summary>
    public int? RemainingStock { get; set; }

    public bool IsVegetarian { get; init; }

    public bool IsVegan { get; init; }

    public bool IsGlutenFree { get; init; }

    public bool IsHalal { get; init; }

    public string? Allergens { get; init; }
    public string? MayContainAllergens { get; init; }
    public string? CrossContactStatement { get; init; }
    public DateTime? AllergenInfoLastVerifiedAt { get; init; }

    public int SpiceLevel { get; init; }

    public string? ServingSize { get; init; }

    public int? Calories { get; init; }

    public bool IsPopular { get; init; }

    public bool IsRecommended { get; init; }

    public int DisplayOrder { get; init; }

    public IReadOnlyList<MenuOptionGroupResponse> OptionGroups { get; init; } = [];
}
