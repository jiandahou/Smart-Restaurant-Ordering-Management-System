namespace DineFlow.Api.Contracts.Restaurant;

public class RestaurantResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Address { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string LegalBusinessName { get; set; } = string.Empty;
    public string? Abn { get; set; }
    public bool GstRegistered { get; set; }
    public bool PricesIncludeGst { get; set; }
    public string BusinessContactEmail { get; set; } = string.Empty;
    public string RefundContactEmail { get; set; } = string.Empty;
    public string? CustomerSurchargeNotice { get; set; }

    public string? ImageUrl { get; set; }

    public string CountryCode { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string PaymentPolicy { get; set; } = string.Empty;

    public string StripeConnectStatus { get; set; } = "NotConnected";

    public bool OnlinePaymentsEnabled { get; set; }

    /// <summary>
    /// Refund requests waiting on a decision here.
    /// </summary>
    /// <remarks>
    /// Carried on the list as well as on the operations record because the platform owner is
    /// assigned to no restaurant at all, so the single-restaurant record is always empty for them —
    /// the same reason the Stripe warnings are assembled from this list. Without it the one account
    /// that oversees every restaurant is the one account told about none of them.
    /// </remarks>
    public int PendingRefundRequestCount { get; set; }

    /// <summary>When the longest-waiting of those was filed, or null when none are waiting.</summary>
    public DateTime? OldestPendingRefundRequestAt { get; set; }

    /// <summary>
    /// Where this restaurant stands with the platform.
    /// </summary>
    /// <remarks>
    /// On the list as well as on the operations record, for the same reason the pending refund
    /// count is: the platform owner is assigned to no restaurant, so their own operations record is
    /// always empty and this list is the only thing that knows.
    /// </remarks>
    public RestaurantBillingStandingResponse Billing { get; set; } = new();

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

    public string StripeConnectStatus { get; set; } = "NotConnected";

    public bool OnlinePaymentsEnabled { get; set; }

    /// <summary>
    /// Refund requests waiting on a decision at this restaurant.
    /// </summary>
    /// <remarks>
    /// A customer who asks for their money back is waiting on a person, and nothing told that person
    /// they were waiting: the queue lived on one admin screen that had to be visited to be seen. The
    /// bell already carries the things staff must act on — a printer that has stopped, payments that
    /// cannot be taken — and this belongs with them.
    /// </remarks>
    public int PendingRefundRequestCount { get; set; }

    /// <summary>
    /// When the longest-waiting of those was filed, or null when none are waiting.
    /// </summary>
    /// <remarks>
    /// The count alone does not say whether anything is wrong — three requests filed in the last
    /// hour on a busy Friday is a queue being worked. One filed on Tuesday and still sitting on
    /// Thursday is somebody's money being held with nobody looking, and only the age says which of
    /// those is on screen.
    /// </remarks>
    public DateTime? OldestPendingRefundRequestAt { get; set; }

    /// <summary>
    /// Where this restaurant stands with the platform, and when ordering stops if nothing is paid.
    /// </summary>
    /// <remarks>
    /// Rides on the record the console already polls, so the countdown costs no new request and
    /// refreshes on the same minute, focus and invalidation as everything else on that panel.
    /// </remarks>
    public RestaurantBillingStandingResponse Billing { get; set; } = new();
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
