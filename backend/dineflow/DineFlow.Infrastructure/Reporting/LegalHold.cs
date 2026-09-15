namespace DineFlow.Infrastructure.Reporting;

/// <summary>Which body of report evidence a hold covers.</summary>
public enum HeldRecordType
{
    AuditLog = 0,
    OrderEvent = 1,
    PaymentEvent = 2,
}

/// <summary>
/// An instruction that some evidence must not be deleted, whatever the retention period says.
/// </summary>
/// <remarks>
/// <para>
/// The policy named a "legal hold register" and the register was a configuration string: a value
/// asserting that holds were being tracked somewhere else. Nothing read it, so a retention run would
/// have deleted evidence under hold and the only sign would have been the absence of rows.
/// </para>
/// <para>
/// Scoped rather than global on purpose. A dispute over one order should not freeze seven years of
/// unrelated evidence, and a hold that is too expensive to place is a hold nobody places.
/// </para>
/// </remarks>
public class LegalHold
{
    public Guid Id { get; set; }

    public HeldRecordType RecordType { get; set; }

    /// <summary>Null holds every restaurant's records of this type.</summary>
    public Guid? RestaurantId { get; set; }

    /// <summary>Null holds every order for the scope above.</summary>
    public Guid? OrderId { get; set; }

    /// <summary>Why, in the words an investigation will read years later.</summary>
    public string Reason { get; set; } = string.Empty;

    /// <summary>Who placed it. A hold nobody signed is a hold nobody can release.</summary>
    public string PlacedBy { get; set; } = string.Empty;

    public DateTime PlacedAt { get; set; }

    /// <summary>When it stopped applying. A released hold is kept, not deleted.</summary>
    public DateTime? ReleasedAt { get; set; }

    public string? ReleasedBy { get; set; }

    public bool IsActive(DateTime now) => PlacedAt <= now && ReleasedAt is null;
}
