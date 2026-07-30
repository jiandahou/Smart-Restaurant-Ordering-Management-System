namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantRequest
{
    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = "AU";

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string PaymentPolicy { get; set; } = "PayAtCounterAllowed";

    public bool IsActive { get; set; } = true;

    public bool AcceptingOrders { get; set; } = true;

    public string? OpeningHoursJson { get; set; }

    public string? SpecialOpeningDaysJson { get; set; }
}

public class RestaurantOrderingStatusRequest
{
    public bool AcceptingOrders { get; set; }

    /// <summary>
    /// Optional auto-resume window when pausing. Omit for an indefinite pause. Ignored when
    /// resuming.
    /// </summary>
    public int? PauseMinutes { get; set; }

    /// <summary>
    /// Pause for the rest of the current trading period and resume automatically at the next
    /// scheduled opening. Takes precedence over <see cref="PauseMinutes"/>. Ignored when resuming.
    /// </summary>
    public bool PauseUntilNextOpening { get; set; }
}

/// <summary>
/// Writes only the weekly schedule, so a concurrent special-calendar edit can't be clobbered.
/// </summary>
public class RestaurantOpeningHoursRequest
{
    public string? OpeningHoursJson { get; set; }
}

/// <summary>Writes only the special-day overrides. See <see cref="RestaurantOpeningHoursRequest"/>.</summary>
public class RestaurantSpecialOpeningDaysRequest
{
    public string? SpecialOpeningDaysJson { get; set; }
}

public class RestaurantAutoAcceptRequest
{
    public bool AutoAcceptOrders { get; set; }
}
