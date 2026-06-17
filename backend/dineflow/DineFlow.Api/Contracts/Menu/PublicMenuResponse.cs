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

    public int DisplayOrder { get; init; }
}
