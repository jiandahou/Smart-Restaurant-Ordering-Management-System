namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantRequest
{
    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string LegalBusinessName { get; set; } = string.Empty;
    public string? Abn { get; set; }
    public bool GstRegistered { get; set; }
    public bool PricesIncludeGst { get; set; } = true;
    public string BusinessContactEmail { get; set; } = string.Empty;
    public string RefundContactEmail { get; set; } = string.Empty;
    public string? CustomerSurchargeNotice { get; set; }

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
public class RestaurantOpeningHoursRequest : IScheduleConcurrencyRequest
{
    public string? OpeningHoursJson { get; set; }

    public DateTime? ExpectedUpdatedAt { get; set; }
}

/// <summary>
/// Carries the version the editor was working from.
///
/// <para>
/// The whole schedule is written as one JSON document, so a save is not a change to a field but a
/// replacement of the entire calendar. Two administrators editing at once each sent a complete
/// snapshot, both succeeded, and the earlier one's work vanished with nothing to indicate it.
/// </para>
/// </summary>
public interface IScheduleConcurrencyRequest
{
    /// <summary>
    /// The restaurant's <c>UpdatedAt</c> when the editor loaded it. Null skips the check, which
    /// keeps older clients working.
    /// </summary>
    DateTime? ExpectedUpdatedAt { get; set; }
}

/// <summary>Writes only the special-day overrides. See <see cref="RestaurantOpeningHoursRequest"/>.</summary>
public class RestaurantSpecialOpeningDaysRequest : IScheduleConcurrencyRequest
{
    public string? SpecialOpeningDaysJson { get; set; }

    public DateTime? ExpectedUpdatedAt { get; set; }
}

public class RestaurantAutoAcceptRequest
{
    public bool AutoAcceptOrders { get; set; }
}
