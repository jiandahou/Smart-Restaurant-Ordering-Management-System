namespace DineFlow.Infrastructure.Reporting;

/// <summary>
/// Whether a hold covers a particular record.
/// </summary>
/// <remarks>
/// Stated once, away from the maintenance job, because the same question is asked by the job that
/// deletes and by any screen that wants to explain why a row is still there. Two copies of "is this
/// held?" is one copy that eventually says no when the answer is yes.
/// </remarks>
public static class LegalHoldScope
{
    /// <summary>
    /// Whether any active hold covers this record.
    /// </summary>
    /// <param name="restaurantId">The record's restaurant, or null when it belongs to none.</param>
    /// <param name="orderId">The record's order, or null when it concerns none.</param>
    public static bool Covers(
        IEnumerable<LegalHold> activeHolds,
        HeldRecordType recordType,
        Guid? restaurantId,
        Guid? orderId) =>
        activeHolds.Any(hold =>
            hold.RecordType == recordType
            // A null on the hold means "everything at this level", so it widens rather than
            // narrows. A hold naming a restaurant the record does not belong to does not apply.
            && (hold.RestaurantId is null || hold.RestaurantId == restaurantId)
            && (hold.OrderId is null || hold.OrderId == orderId));
}
