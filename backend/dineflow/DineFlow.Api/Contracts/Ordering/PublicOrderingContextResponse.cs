namespace DineFlow.Api.Contracts.Ordering;

public sealed class PublicOrderingContextResponse
{
    public required PublicOrderingRestaurantResponse Restaurant { get; init; }

    public PublicOrderingTableResponse? Table { get; init; }

    public required string OrderType { get; init; }

    public required IReadOnlyList<string> AvailableOrderTypes { get; init; }

    public required string MenuEntryUrl { get; init; }
}

public sealed class PublicOrderingRestaurantResponse
{
    public Guid Id { get; init; }

    public required string Name { get; init; }

    public required string Address { get; init; }

    public required string Phone { get; init; }

    public string? ImageUrl { get; init; }

    public required string Timezone { get; init; }

    public required string Currency { get; init; }

    public required string PaymentPolicy { get; init; }

    public bool OnlinePaymentsEnabled { get; init; }

    public bool AcceptingOrders { get; init; }

    public required string OpeningHoursJson { get; init; }

    public required string SpecialOpeningDaysJson { get; init; }

    public bool IsWithinOpeningHours { get; init; }

    public bool IsOrderingAvailable { get; init; }

    public required string OrderingUnavailableReason { get; init; }

    public required string OrderingStatusMessage { get; init; }
}

public sealed class PublicOrderingTableResponse
{
    public Guid Id { get; init; }

    public required string TableNumber { get; init; }

    public int Capacity { get; init; }
}
