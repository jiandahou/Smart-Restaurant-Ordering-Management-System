namespace DineFlow.Api.Contracts.Ordering;

public sealed class PublicOrderingContextResponse
{
    public required PublicOrderingRestaurantResponse Restaurant { get; init; }

    public PublicOrderingTableResponse? Table { get; init; }

    public required string OrderType { get; init; }

    public required string MenuEntryUrl { get; init; }
}

public sealed class PublicOrderingRestaurantResponse
{
    public Guid Id { get; init; }

    public required string Name { get; init; }

    public required string Address { get; init; }

    public required string Phone { get; init; }

    public required string Timezone { get; init; }

    public required string Currency { get; init; }
}

public sealed class PublicOrderingTableResponse
{
    public Guid Id { get; init; }

    public required string TableNumber { get; init; }

    public int Capacity { get; init; }
}
