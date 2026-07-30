using System;

namespace DineFlow.Infrastructure.Orders;

/// <summary>
/// One row per restaurant per business day, holding the last pickup number handed out.
/// Numbers are allocated with a single atomic upsert so concurrent checkouts can never
/// receive the same number.
/// </summary>
public class RestaurantPickupCounter
{
    public Guid RestaurantId { get; set; }

    public DateOnly PickupDate { get; set; }

    public int LastNumber { get; set; }
}
