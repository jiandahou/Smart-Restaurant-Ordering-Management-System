namespace DineFlow.Api.Contracts.Payments;

public sealed class ReviewRefundRequestRequest
{
    public string? Note { get; set; }

    /// <summary>
    /// One total for the whole request, split across the customer's selected lines.
    /// </summary>
    /// <remarks>
    /// Ignored when <see cref="Items"/> is given, which says the same thing more precisely. Sending
    /// both is refused rather than silently resolved: two different answers to "how much" is a
    /// mistake worth surfacing, not one worth picking a winner for.
    /// </remarks>
    public long? AmountCents { get; set; }

    /// <summary>
    /// What staff approved for each line.
    /// </summary>
    /// <remarks>
    /// The lever that was missing. Staff usually know which dish was the problem, and the only way
    /// to express a partial approval used to be lowering the total — after which the per-line
    /// figures were worked out by proportion rather than decided by anyone, and then became the
    /// balance every later refund on those lines was measured against. Lines left out of this list
    /// are not refunded.
    /// </remarks>
    public List<ReviewRefundRequestItemInput>? Items { get; set; }
}

public sealed class ReviewRefundRequestItemInput
{
    public Guid OrderItemId { get; set; }

    public long AmountCents { get; set; }
}
