using DineFlow.Api.Contracts.Order;

namespace DineFlow.Api.Contracts.Cart;

public sealed class JoinCartRequest
{
    public Guid? RestaurantId { get; init; }

    public string? TableQrToken { get; init; }
}

public sealed class JoinCartResponse
{
    public required string ParticipantToken { get; init; }

    public required CartResponse Cart { get; init; }
}

public sealed class AddCartItemRequest
{
    public Guid MenuItemId { get; init; }

    public int Quantity { get; init; } = 1;

    public string? Note { get; init; }
}

public sealed class UpdateCartItemRequest
{
    public int Quantity { get; init; }

    public string? Note { get; init; }
}

public sealed class UpdateCartNoteRequest
{
    public string? Note { get; init; }
}

public sealed class CheckoutCartResponse
{
    public required string Message { get; init; }

    public required OrderResponse Order { get; init; }
}

public sealed class CartResponse
{
    public Guid Id { get; init; }

    public Guid RestaurantId { get; init; }

    public Guid? TableId { get; init; }

    public string? TableNumber { get; init; }

    public required string OrderType { get; init; }

    public required string Status { get; init; }

    public string? CustomerNote { get; init; }

    public DateTime ExpiresAt { get; init; }

    public DateTime CreatedAt { get; init; }

    public DateTime? UpdatedAt { get; init; }

    public decimal Total { get; init; }

    public int ItemCount { get; init; }

    public required IReadOnlyCollection<CartItemResponse> Items { get; init; }
}

public sealed class CartItemResponse
{
    public Guid Id { get; init; }

    public Guid MenuItemId { get; init; }

    public required string Name { get; init; }

    public string? ImageUrl { get; init; }

    public int Quantity { get; init; }

    public decimal UnitPrice { get; init; }

    public decimal LineTotal { get; init; }

    public string? Note { get; init; }

    public bool IsAvailable { get; init; }

    public bool IsSoldOut { get; init; }

    public DateTime CreatedAt { get; init; }

    public DateTime? UpdatedAt { get; init; }
}
