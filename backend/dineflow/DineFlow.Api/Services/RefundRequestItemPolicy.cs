using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

/// <param name="OrderItemOptionId">
/// The extra this allocation is for, or null for the line as a whole — which is what every
/// allocation meant before extras could be named, so the default needs no thought at call sites
/// that have no extra to name.
/// </param>
public sealed record RefundItemAllocation(
    Guid OrderItemId,
    string MenuItemNameSnapshot,
    int Quantity,
    long AmountCents,
    Guid? OrderItemOptionId = null,
    string? OptionNameSnapshot = null);

public static class RefundRequestItemPolicy
{
    public static bool IsValidQuantity(int requestedQuantity, int orderItemQuantity) =>
        requestedQuantity > 0 && requestedQuantity <= orderItemQuantity;

    public static bool IsValidAmount(
        long requestedAmountCents,
        long selectedQuantityAmountCents,
        long remainingLineAmountCents) =>
        requestedAmountCents > 0
        && requestedAmountCents <= selectedQuantityAmountCents
        && requestedAmountCents <= remainingLineAmountCents;

    public static int GetRefundedQuantity(long refundedAmountCents, long unitPriceCents, int orderQuantity)
    {
        if (refundedAmountCents <= 0 || unitPriceCents <= 0 || orderQuantity <= 0)
        {
            return 0;
        }

        return Math.Min(orderQuantity, (int)(refundedAmountCents / unitPriceCents));
    }

    public static IReadOnlyList<(Guid OrderItemId, long AmountCents)> AttributeSucceededRefund(
        long refundAmountCents,
        IReadOnlyList<(Guid OrderItemId, long AmountCents)> requestedItems)
    {
        if (refundAmountCents <= 0 || requestedItems.Count == 0)
        {
            return [];
        }

        var requestedAmountCents = requestedItems.Sum(item => item.AmountCents);
        if (requestedAmountCents == refundAmountCents)
        {
            return requestedItems;
        }

        if (requestedItems.Count == 1 && refundAmountCents <= requestedAmountCents)
        {
            return [(requestedItems[0].OrderItemId, refundAmountCents)];
        }

        return [];
    }

    /// <summary>What staff decided, line by line, or why it could not be accepted.</summary>
    public sealed record StaffChosenRefund(
        string? Error,
        long ApprovedAmountCents,
        IReadOnlyList<RefundItemAllocation> Allocations)
    {
        public bool IsValid => Error is null;

        public static StaffChosenRefund Invalid(string error) => new(error, 0, []);
    }

    /// <summary>
    /// Takes an approval that names an amount for each line, rather than one total to be split.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Staff usually know which dish was the problem — the wings were cold, the spring rolls were
    /// fine — and until this there was nowhere to say so. The only lever was the total, and
    /// <see cref="AllocateApprovedRefund"/> then spread it across every line the customer had
    /// selected. Those per-line figures were nobody's decision, and they did not stay cosmetic:
    /// they are written to the refund and become the balance that every later refund on those
    /// lines is measured against. A split that no one chose became the ledger.
    /// </para>
    /// <para>
    /// A line may be reduced or zeroed — zero being the point, since it is how staff say "not this
    /// one" — but never raised above what the customer asked for on it. Approving more than was
    /// requested is not an adjustment, it is a refund of something nobody claimed.
    /// </para>
    /// </remarks>
    /// <param name="requestedItems">The lines the customer selected, with the amounts they asked for.</param>
    /// <param name="chosen">The amount staff approved for each line. Lines left out are not refunded.</param>
    public static StaffChosenRefund AllocateStaffChosenRefund(
        IReadOnlyList<RefundItemAllocation> requestedItems,
        IReadOnlyList<(Guid OrderItemId, Guid? OrderItemOptionId, long AmountCents)> chosen)
    {
        if (chosen.Count == 0)
        {
            return StaffChosenRefund.Invalid("Choose an amount for at least one item.");
        }

        // Matched on both halves: a dish and one of its extras are two lines of the request, and
        // keying on the dish alone would let one amount silently replace the other.
        if (chosen
                .Select(item => (item.OrderItemId, item.OrderItemOptionId))
                .Distinct()
                .Count() != chosen.Count)
        {
            return StaffChosenRefund.Invalid("Each order item can only be given one amount.");
        }

        var allocations = new List<RefundItemAllocation>();

        foreach (var (orderItemId, orderItemOptionId, amountCents) in chosen)
        {
            var requested = requestedItems.FirstOrDefault(item =>
                item.OrderItemId == orderItemId && item.OrderItemOptionId == orderItemOptionId);

            if (requested is null)
            {
                return StaffChosenRefund.Invalid("An approved item was not part of this refund request.");
            }

            if (amountCents < 0)
            {
                return StaffChosenRefund.Invalid(
                    $"Approved amount for \"{requested.MenuItemNameSnapshot}\" cannot be negative.");
            }

            if (amountCents > requested.AmountCents)
            {
                return StaffChosenRefund.Invalid(
                    $"Approved amount for \"{requested.MenuItemNameSnapshot}\" cannot exceed the "
                    + $"{requested.AmountCents} cents the customer asked for.");
            }

            // Dropped rather than recorded as a zero: staff saying "not this one" is the absence of
            // a refund on that line, and a zero-cent refund item would claim its balance was touched.
            if (amountCents > 0)
            {
                allocations.Add(requested with { AmountCents = amountCents });
            }
        }

        var approvedAmountCents = allocations.Sum(item => item.AmountCents);

        return approvedAmountCents > 0
            ? new StaffChosenRefund(null, approvedAmountCents, allocations)
            : StaffChosenRefund.Invalid("Approve more than zero, or reject the request instead.");
    }

    /// <summary>
    /// Splits one staff-adjusted total across the lines the customer selected.
    /// </summary>
    /// <remarks>
    /// Kept for approvals that name only a total — a full approval, or a client that predates
    /// per-line amounts. Where staff have said which line is which,
    /// <see cref="AllocateStaffChosenRefund"/> is used instead and nothing here is guessed.
    /// </remarks>
    public static IReadOnlyList<RefundItemAllocation> AllocateApprovedRefund(
        long approvedAmountCents,
        IReadOnlyList<RefundItemAllocation> requestedItems)
    {
        if (approvedAmountCents <= 0 || requestedItems.Count == 0)
        {
            return [];
        }

        var requestedTotal = requestedItems.Sum(item => item.AmountCents);
        if (approvedAmountCents > requestedTotal)
        {
            return [];
        }

        if (approvedAmountCents == requestedTotal)
        {
            return requestedItems;
        }

        // Pro-rate a staff-adjusted approval across all selected lines. Integer cents left after
        // division go to the largest remainders, with OrderItemId as a stable tie-breaker.
        var shares = requestedItems
            .Select(item => new
            {
                Item = item,
                Amount = (approvedAmountCents * item.AmountCents) / requestedTotal,
                Remainder = (approvedAmountCents * item.AmountCents) % requestedTotal
            })
            .ToList();
        var centsLeft = approvedAmountCents - shares.Sum(share => share.Amount);
        var bonusIds = shares
            .OrderByDescending(share => share.Remainder)
            .ThenBy(share => share.Item.OrderItemId)
            .Take((int)centsLeft)
            .Select(share => share.Item.OrderItemId)
            .ToHashSet();

        return shares
            .Select(share => new RefundItemAllocation(
                share.Item.OrderItemId,
                share.Item.MenuItemNameSnapshot,
                share.Item.Quantity,
                share.Amount + (bonusIds.Contains(share.Item.OrderItemId) ? 1 : 0)))
            .Where(item => item.AmountCents > 0)
            .ToList();
    }

    public static IReadOnlyDictionary<Guid, long> BuildAttributedRefundAmounts(Order order)
    {
        var amounts = new Dictionary<Guid, long>();
        foreach (var allocation in EnumerateAttributedRefundAllocations(order))
        {
            amounts[allocation.OrderItemId] = amounts.GetValueOrDefault(allocation.OrderItemId)
                + allocation.AmountCents;
        }

        return amounts;
    }

    public static IEnumerable<(Guid OrderItemId, long AmountCents)> EnumerateAttributedRefundAllocations(
        Order order) =>
        EnumerateAttributedRefundAllocationsByModifier(order)
            .Select(allocation => (allocation.OrderItemId, allocation.AmountCents));

    /// <summary>
    /// How much each succeeded refund returned, per line and — where it said so — per modifier.
    /// </summary>
    /// <remarks>
    /// The modifier is null for every refund that named a line rather than one of its extras, which
    /// is every refund made before extras could be named at all. That null is the older meaning
    /// rather than missing information, so nothing here has to guess on behalf of historical rows.
    /// </remarks>
    public static IEnumerable<(Guid OrderItemId, Guid? OrderItemOptionId, long AmountCents)>
        EnumerateAttributedRefundAllocationsByModifier(Order order)
    {
        var requestsByRefundId = order.RefundRequests
            .Where(request => request.PaymentRefundId.HasValue)
            .GroupBy(request => request.PaymentRefundId!.Value)
            .ToDictionary(group => group.Key, group => group.First());

        foreach (var refund in order.Payments
                     .SelectMany(payment => payment.Refunds)
                     .Where(refund => refund.Status == PaymentRefundStatus.Succeeded))
        {
            if (refund.Items.Count > 0)
            {
                foreach (var item in refund.Items)
                {
                    yield return (item.OrderItemId, item.OrderItemOptionId, item.AmountCents);
                }

                continue;
            }

            // Compatibility for refunds created before PaymentRefundItems existed.
            if (!requestsByRefundId.TryGetValue(refund.Id, out var request) || request.Items.Count == 0)
            {
                continue;
            }

            foreach (var allocation in AttributeSucceededRefund(
                         refund.AmountCents,
                         request.Items.Select(item => (item.OrderItemId, item.AmountCents)).ToList()))
            {
                // Reconstructed from a request that predates modifier references, so it can only
                // have meant the line as a whole.
                yield return (allocation.OrderItemId, (Guid?)null, allocation.AmountCents);
            }
        }
    }

    /// <summary>How much has been refunded against each modifier by name.</summary>
    public static IReadOnlyDictionary<Guid, long> BuildAttributedModifierAmounts(Order order)
    {
        var amounts = new Dictionary<Guid, long>();

        foreach (var allocation in EnumerateAttributedRefundAllocationsByModifier(order))
        {
            if (allocation.OrderItemOptionId is not { } optionId)
            {
                continue;
            }

            amounts[optionId] = amounts.GetValueOrDefault(optionId) + allocation.AmountCents;
        }

        return amounts;
    }

    /// <summary>
    /// Whether each line has been refunded as a whole, by its parts, or not yet at all.
    /// </summary>
    /// <remarks>
    /// Lines with no refunds are absent rather than present as
    /// <see cref="LineRefundGranularity.Untouched"/>; a lookup that misses is the same answer and
    /// costs nothing to carry.
    /// </remarks>
    public static IReadOnlyDictionary<Guid, LineRefundGranularity> BuildSettledGranularity(Order order)
    {
        var tagged = new Dictionary<Guid, List<bool>>();

        foreach (var allocation in EnumerateAttributedRefundAllocationsByModifier(order))
        {
            if (!tagged.TryGetValue(allocation.OrderItemId, out var flags))
            {
                flags = [];
                tagged[allocation.OrderItemId] = flags;
            }

            flags.Add(allocation.OrderItemOptionId is not null);
        }

        return tagged.ToDictionary(
            entry => entry.Key,
            entry => LineRefundGranularityPolicy.Settled(entry.Value));
    }

    public static bool HasAtLeastOneItem<T>(IReadOnlyCollection<T> items) => items.Count > 0;
}
