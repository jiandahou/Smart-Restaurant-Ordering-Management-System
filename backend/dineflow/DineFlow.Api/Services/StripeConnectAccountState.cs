using System.Text.Json;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Infrastructure.Restaurant;
using Stripe;

namespace DineFlow.Api.Services;

public sealed class StripeConnectAccountStateSnapshot
{
    public int Version { get; set; } = 2;

    public string? DisabledReason { get; set; }

    public DateTime? CurrentDeadline { get; set; }

    public string[] CurrentlyDue { get; set; } = [];

    public string[] PastDue { get; set; } = [];

    public string[] EventuallyDue { get; set; } = [];

    public string[] PendingVerification { get; set; } = [];

    public string[] FutureCurrentlyDue { get; set; } = [];

    public string[] FutureEventuallyDue { get; set; } = [];

    public string[] FuturePendingVerification { get; set; } = [];

    public StripeConnectRequirementErrorSnapshot[] Errors { get; set; } = [];
}

public sealed class StripeConnectRequirementErrorSnapshot
{
    public string Code { get; set; } = string.Empty;

    public string Requirement { get; set; } = string.Empty;

    public string Reason { get; set; } = string.Empty;
}

public static class StripeConnectAccountState
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public static void Apply(Restaurant restaurant, Account account)
    {
        var snapshot = CreateSnapshot(account);

        restaurant.StripeDetailsSubmitted = account.DetailsSubmitted;
        restaurant.StripeChargesEnabled = account.ChargesEnabled;
        restaurant.StripePayoutsEnabled = account.PayoutsEnabled;
        restaurant.StripeRequirementsDueJson = JsonSerializer.Serialize(snapshot, JsonOptions);
        restaurant.StripeAccountUpdatedAt = DateTime.UtcNow;
    }

    public static StripeConnectAccountStateSnapshot Read(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return new StripeConnectAccountStateSnapshot();
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind == JsonValueKind.Array)
            {
                return new StripeConnectAccountStateSnapshot
                {
                    CurrentlyDue = document.RootElement
                        .EnumerateArray()
                        .Where(item => item.ValueKind == JsonValueKind.String)
                        .Select(item => item.GetString())
                        .Where(item => !string.IsNullOrWhiteSpace(item))
                        .Cast<string>()
                        .Distinct(StringComparer.Ordinal)
                        .Order(StringComparer.Ordinal)
                        .ToArray()
                };
            }

            return JsonSerializer.Deserialize<StripeConnectAccountStateSnapshot>(json, JsonOptions)
                ?? new StripeConnectAccountStateSnapshot();
        }
        catch (JsonException)
        {
            return new StripeConnectAccountStateSnapshot();
        }
    }

    public static IReadOnlyList<string> GetActionableRequirements(
        StripeConnectAccountStateSnapshot snapshot) =>
        snapshot.CurrentlyDue
            .Concat(snapshot.PastDue)
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

    public static IReadOnlyList<StripeConnectRestrictionResponse> BuildRestrictions(
        StripeConnectAccountStateSnapshot snapshot,
        bool detailsSubmitted,
        bool chargesEnabled,
        bool payoutsEnabled)
    {
        var restrictions = new List<StripeConnectRestrictionResponse>();
        var representedRequirements = new HashSet<string>(StringComparer.Ordinal);

        foreach (var error in snapshot.Errors.Where(error => !string.IsNullOrWhiteSpace(error.Requirement)))
        {
            representedRequirements.Add(error.Requirement);
            restrictions.Add(new StripeConnectRestrictionResponse
            {
                Code = string.IsNullOrWhiteSpace(error.Code) ? "verification_error" : error.Code,
                Title = GetRequirementLabel(error.Requirement),
                Message = string.IsNullOrWhiteSpace(error.Reason)
                    ? "Stripe could not verify this information. Update it in Stripe."
                    : error.Reason,
                Severity = "Error",
                Requirement = error.Requirement,
                ActionRequired = true
            });
        }

        AddRequirements(
            restrictions,
            representedRequirements,
            snapshot.PastDue,
            "PastDue",
            "This information is overdue and is restricting the Stripe account.",
            "Error",
            true);
        AddRequirements(
            restrictions,
            representedRequirements,
            snapshot.CurrentlyDue,
            "CurrentlyDue",
            "Stripe needs this information to keep payments and payouts available.",
            "Warning",
            true);
        AddRequirements(
            restrictions,
            representedRequirements,
            snapshot.PendingVerification.Concat(snapshot.FuturePendingVerification),
            "PendingVerification",
            "Stripe is reviewing the submitted information. No action is required right now.",
            "Info",
            false);

        if (!string.IsNullOrWhiteSpace(snapshot.DisabledReason) &&
            restrictions.All(item => !string.Equals(item.Code, snapshot.DisabledReason, StringComparison.Ordinal)))
        {
            restrictions.Insert(0, BuildDisabledReason(snapshot.DisabledReason));
        }

        if (!detailsSubmitted && restrictions.Count == 0)
        {
            restrictions.Add(new StripeConnectRestrictionResponse
            {
                Code = "details_incomplete",
                Title = "Stripe setup is incomplete",
                Message = "Complete the outstanding business and account information in Stripe.",
                Severity = "Warning",
                ActionRequired = true
            });
        }

        if (!chargesEnabled && restrictions.All(item => item.Code != "charges_disabled"))
        {
            restrictions.Add(new StripeConnectRestrictionResponse
            {
                Code = "charges_disabled",
                Title = "Customer payments are unavailable",
                Message = "Stripe has not enabled charges for this account yet.",
                Severity = "Error",
                ActionRequired = true
            });
        }

        if (!payoutsEnabled && restrictions.All(item => item.Code != "payouts_disabled"))
        {
            restrictions.Add(new StripeConnectRestrictionResponse
            {
                Code = "payouts_disabled",
                Title = "Bank payouts are unavailable",
                Message = "Funds cannot be paid out until Stripe enables payouts for this account.",
                Severity = chargesEnabled ? "Warning" : "Error",
                ActionRequired = true
            });
        }

        return restrictions;
    }

    public static IReadOnlyList<StripeConnectDiagnosticCheckResponse> BuildDiagnosticChecks(
        Restaurant restaurant,
        StripeConnectAccountStateSnapshot snapshot) =>
        [
            new()
            {
                Code = "account_access",
                Label = "Connected account",
                Status = "Passed",
                Message = $"Stripe returned account {restaurant.StripeAccountId} successfully."
            },
            new()
            {
                Code = "direct_charges",
                Label = "Direct charges",
                Status = restaurant.StripeChargesEnabled ? "Passed" : "Failed",
                Message = restaurant.StripeChargesEnabled
                    ? "The restaurant can accept direct customer charges."
                    : "Direct customer charges are currently unavailable."
            },
            new()
            {
                Code = "payouts",
                Label = "Bank payouts",
                Status = restaurant.StripePayoutsEnabled ? "Passed" : "Warning",
                Message = restaurant.StripePayoutsEnabled
                    ? "Stripe payouts are enabled."
                    : "Stripe payouts are pending or restricted."
            },
            new()
            {
                Code = "requirements",
                Label = "Verification requirements",
                Status = snapshot.Errors.Length > 0 || snapshot.PastDue.Length > 0
                    ? "Failed"
                    : snapshot.CurrentlyDue.Length > 0 || snapshot.PendingVerification.Length > 0
                        ? "Warning"
                        : "Passed",
                Message = BuildRequirementCheckMessage(snapshot)
            }
        ];

    private static StripeConnectAccountStateSnapshot CreateSnapshot(Account account) => new()
    {
        DisabledReason = account.Requirements?.DisabledReason,
        CurrentDeadline = account.Requirements?.CurrentDeadline,
        CurrentlyDue = Clean(account.Requirements?.CurrentlyDue),
        PastDue = Clean(account.Requirements?.PastDue),
        EventuallyDue = Clean(account.Requirements?.EventuallyDue),
        PendingVerification = Clean(account.Requirements?.PendingVerification),
        FutureCurrentlyDue = Clean(account.FutureRequirements?.CurrentlyDue),
        FutureEventuallyDue = Clean(account.FutureRequirements?.EventuallyDue),
        FuturePendingVerification = Clean(account.FutureRequirements?.PendingVerification),
        Errors = (account.Requirements?.Errors ?? [])
            .Select(error => new StripeConnectRequirementErrorSnapshot
            {
                Code = error.Code ?? string.Empty,
                Requirement = error.Requirement ?? string.Empty,
                Reason = error.Reason ?? string.Empty
            })
            .Where(error => !string.IsNullOrWhiteSpace(error.Requirement) ||
                !string.IsNullOrWhiteSpace(error.Reason))
            .ToArray()
    };

    private static string[] Clean(IEnumerable<string>? values) =>
        (values ?? [])
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();

    private static void AddRequirements(
        ICollection<StripeConnectRestrictionResponse> restrictions,
        ISet<string> representedRequirements,
        IEnumerable<string> requirements,
        string code,
        string message,
        string severity,
        bool actionRequired)
    {
        foreach (var requirement in requirements.Where(item => !string.IsNullOrWhiteSpace(item)))
        {
            if (!representedRequirements.Add(requirement))
            {
                continue;
            }

            restrictions.Add(new StripeConnectRestrictionResponse
            {
                Code = code,
                Title = GetRequirementLabel(requirement),
                Message = message,
                Severity = severity,
                Requirement = requirement,
                ActionRequired = actionRequired
            });
        }
    }

    private static StripeConnectRestrictionResponse BuildDisabledReason(string disabledReason) =>
        disabledReason switch
        {
            "requirements.pending_verification" => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe verification is in progress",
                Message = "Stripe is reviewing submitted information. No action is required unless Stripe asks for an update.",
                Severity = "Info",
                ActionRequired = false
            },
            "under_review" => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe account is under review",
                Message = "Stripe is reviewing the account. Check Stripe for updates or requests.",
                Severity = "Info",
                ActionRequired = false
            },
            "requirements.past_due" => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe information is overdue",
                Message = "Complete the overdue requirements in Stripe to restore account capabilities.",
                Severity = "Error",
                ActionRequired = true
            },
            "action_required.requested_capabilities" => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe capability setup is incomplete",
                Message = "Stripe needs more information before it can enable the requested payment capabilities.",
                Severity = "Warning",
                ActionRequired = true
            },
            _ when disabledReason.StartsWith("rejected.", StringComparison.Ordinal) => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe rejected this account",
                Message = "Open Stripe to review the decision and any available resolution steps.",
                Severity = "Error",
                ActionRequired = true
            },
            _ => new StripeConnectRestrictionResponse
            {
                Code = disabledReason,
                Title = "Stripe has restricted this account",
                Message = $"Stripe reported: {disabledReason.Replace('_', ' ')}.",
                Severity = "Warning",
                ActionRequired = true
            }
        };

    private static string GetRequirementLabel(string requirement)
    {
        if (requirement.EndsWith(".verification.additional_document", StringComparison.Ordinal))
        {
            return "Proof of residential address";
        }

        if (requirement.EndsWith(".verification.document", StringComparison.Ordinal))
        {
            return "Account representative identity document";
        }

        return requirement switch
        {
            "external_account" => "Payout bank account",
            "company.tax_id" => "Business tax ID (ABN)",
            "company.verification.document" => "Business verification document",
            "company.address.city" or "company.address.line1" or "company.address.postal_code" or
                "company.address.state" => "Business address",
            "individual.address.city" or "individual.address.line1" or "individual.address.postal_code" or
                "individual.address.state" => "Account representative address",
            "company.owners_provided" => "Business owners",
            "company.directors_provided" => "Company directors",
            "company.executives_provided" => "Company executives",
            "business_profile.url" => "Business website",
            "business_profile.product_description" => "Business description",
            "tos_acceptance.date" or "tos_acceptance.ip" => "Stripe service agreement",
            _ => HumanizeRequirement(requirement)
        };
    }

    private static string HumanizeRequirement(string requirement)
    {
        var finalSegment = requirement.Split('.', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()
            ?? requirement;
        return string.Join(
            ' ',
            finalSegment
                .Split('_', StringSplitOptions.RemoveEmptyEntries)
                .Select(word => char.ToUpperInvariant(word[0]) + word[1..]));
    }

    private static string BuildRequirementCheckMessage(StripeConnectAccountStateSnapshot snapshot)
    {
        if (snapshot.Errors.Length > 0)
        {
            return $"{snapshot.Errors.Length} Stripe verification error(s) require attention.";
        }

        if (snapshot.PastDue.Length > 0)
        {
            return $"{snapshot.PastDue.Length} requirement(s) are overdue.";
        }

        if (snapshot.CurrentlyDue.Length > 0)
        {
            return $"{snapshot.CurrentlyDue.Length} requirement(s) need to be completed.";
        }

        if (snapshot.PendingVerification.Length > 0)
        {
            return $"Stripe is reviewing {snapshot.PendingVerification.Length} submitted item(s).";
        }

        return "No current Stripe verification requirements were returned.";
    }
}
