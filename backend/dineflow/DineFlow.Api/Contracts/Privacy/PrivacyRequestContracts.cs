namespace DineFlow.Api.Contracts.Privacy;

public sealed class CreatePrivacyRequest
{
    public string RequestType { get; init; } = string.Empty;
    public string Details { get; init; } = string.Empty;
}

public sealed class PrivacyRequestResponse
{
    public Guid Id { get; init; }
    public string RequestType { get; init; } = string.Empty;
    public string Details { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public DateTime? CompletedAt { get; init; }
}

/// <summary>
/// A privacy request as whoever has to answer it needs to see it.
/// </summary>
/// <remarks>
/// Carries who filed it, which the customer's own view does not need and the person answering cannot
/// do without, and how long is left to answer — the clock is the whole reason this screen exists.
/// </remarks>
public sealed class AdminPrivacyRequestResponse
{
    public Guid Id { get; init; }
    public string RequestType { get; init; } = string.Empty;
    public string Details { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public DateTime? UpdatedAt { get; init; }
    public DateTime? CompletedAt { get; init; }

    public string? RequesterEmail { get; init; }
    public string? RequesterName { get; init; }

    /// <summary>Days left to answer. Negative once the deadline has passed, null once answered.</summary>
    public int? DaysRemaining { get; init; }

    public bool IsOverdue { get; init; }
}

public sealed class UpdatePrivacyRequestStatusRequest
{
    public string Status { get; init; } = string.Empty;

    /// <summary>What was done, kept on the audit record. Required when declining.</summary>
    public string? Note { get; init; }
}
