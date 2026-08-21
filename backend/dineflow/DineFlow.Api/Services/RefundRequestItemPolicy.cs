using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

public sealed record RefundItemAllocation(
    Guid OrderItemId,
    string MenuItemNameSnapshot,
    int Quantity,
    long AmountCents);

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
        Order order)
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
                    yield return (item.OrderItemId, item.AmountCents);
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
                yield return allocation;
            }
        }
    }

    public static bool HasAtLeastOneItem<T>(IReadOnlyCollection<T> items) => items.Count > 0;
}
