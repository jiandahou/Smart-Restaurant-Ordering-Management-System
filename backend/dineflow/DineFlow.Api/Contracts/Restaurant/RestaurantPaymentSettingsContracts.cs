using System.ComponentModel.DataAnnotations;

namespace DineFlow.Api.Contracts.Restaurant;

public sealed class RestaurantPaymentSettingsResponse
{
    public Guid RestaurantId { get; set; }

    public string RestaurantName { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string? StripeAccountId { get; set; }

    public string StripeConnectStatus { get; set; } = "NotConnected";

    public bool StripeDetailsSubmitted { get; set; }

    public bool StripeChargesEnabled { get; set; }

    public bool StripePayoutsEnabled { get; set; }

    public IReadOnlyList<string> StripeRequirementsDue { get; set; } = [];

    public IReadOnlyList<StripeConnectRestrictionResponse> StripeRestrictions { get; set; } = [];

    public DateTime? StripeCurrentDeadline { get; set; }

    public DateTime? StripeConnectedAt { get; set; }

    public DateTime? StripeAccountUpdatedAt { get; set; }

    public decimal OrderPlatformFeePercent { get; set; }

    public long OneTimePlatformFeeCents { get; set; }

    public string OneTimePlatformFeeStatus { get; set; } = "NotRequired";

    public DateTime? OneTimePlatformFeePaidAt { get; set; }

    public bool OnlinePaymentsEnabled { get; set; }
}

public sealed class StripeConnectRestrictionResponse
{
    public string Code { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string Message { get; set; } = string.Empty;

    public string Severity { get; set; } = "Info";

    public string? Requirement { get; set; }

    public bool ActionRequired { get; set; }
}

public sealed class StripeConnectDiagnosticResponse
{
    public string Mode { get; set; } = "Test";

    public DateTime CheckedAt { get; set; }

    public RestaurantPaymentSettingsResponse Settings { get; set; } = new();

    public IReadOnlyList<StripeConnectDiagnosticCheckResponse> Checks { get; set; } = [];
}

public sealed class StripeConnectDiagnosticCheckResponse
{
    public string Code { get; set; } = string.Empty;

    public string Label { get; set; } = string.Empty;

    public string Status { get; set; } = "Passed";

    public string Message { get; set; } = string.Empty;
}

public sealed class UpdateRestaurantPlatformFeesRequest
{
    [Range(typeof(decimal), "0", "100")]
    public decimal OrderPlatformFeePercent { get; set; }

    [Range(0, 100_000_000)]
    public long OneTimePlatformFeeCents { get; set; }
}

public sealed class StripeActionLinkResponse
{
    public string Message { get; set; } = string.Empty;

    public string? Url { get; set; }

    public string? StripeAccountId { get; set; }

    public DateTime? ExpiresAt { get; set; }
}

public sealed class PlatformFeeCheckoutResponse
{
    public string Message { get; set; } = string.Empty;

    public bool Required { get; set; }

    public bool Paid { get; set; }

    public string? CheckoutUrl { get; set; }

    public string? SessionId { get; set; }
}
