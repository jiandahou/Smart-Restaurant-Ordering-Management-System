namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string PaymentPolicy { get; set; } = string.Empty;

    public string StripeConnectStatus { get; set; } = "NotConnected";

    public bool OnlinePaymentsEnabled { get; set; }

    public decimal OrderPlatformFeePercent { get; set; }

    public long OneTimePlatformFeeCents { get; set; }

    public string OneTimePlatformFeeStatus { get; set; } = "NotRequired";

    public bool IsActive { get; set; }

    public bool AcceptingOrders { get; set; }

    /// <summary>UTC instant a timed pause lapses. Null when not paused or paused indefinitely.</summary>
    public DateTime? AcceptingOrdersPausedUntil { get; set; }

    public bool AutoAcceptOrders { get; set; }

    public string OpeningHoursJson { get; set; } = string.Empty;

    public string SpecialOpeningDaysJson { get; set; } = "[]";

    public RestaurantAvailabilityResponse? Availability { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }
}

/// <summary>
/// The currently-evaluated open/closed state, so the UI never has to re-derive opening hours
/// (and never has to guess the restaurant's timezone) to answer "are we open right now?".
/// </summary>
public class RestaurantAvailabilityResponse
{
    public bool IsOrderingAvailable { get; set; }

    public bool IsWithinOpeningHours { get; set; }

    public bool AcceptingOrders { get; set; }

    public string Reason { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    /// <summary>Restaurant-local time the open/closed state next flips (ISO, no offset).</summary>
    public DateTime? NextTransitionLocal { get; set; }

    /// <summary>Restaurant-local time of the next opening; while trading, the one after this one.</summary>
    public DateTime? NextOpeningLocal { get; set; }

    /// <summary>The restaurant's current local time, so the client can render without its own clock.</summary>
    public DateTime LocalNow { get; set; }

    public DateTime? PausedUntilUtc { get; set; }
}

public class RestaurantOperationsResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public bool AutoAcceptOrders { get; set; }
}

/// <summary>
/// Read-only trading state for staff-level roles. Staff cannot reach the admin restaurant API, but
/// they still need to answer "are we open, and when do we close?" — so this exposes the evaluated
/// availability and the schedule without any of the editable profile fields.
/// </summary>
public class RestaurantTradingStatusResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    public bool AcceptingOrders { get; set; }

    public DateTime? AcceptingOrdersPausedUntil { get; set; }

    public string OpeningHoursJson { get; set; } = string.Empty;

    public string SpecialOpeningDaysJson { get; set; } = "[]";

    public RestaurantAvailabilityResponse? Availability { get; set; }
}
