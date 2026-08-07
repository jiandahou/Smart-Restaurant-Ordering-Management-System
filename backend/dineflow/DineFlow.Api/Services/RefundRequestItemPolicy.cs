namespace DineFlow.Api.Services;

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

    public static bool HasAtLeastOneItem<T>(IReadOnlyCollection<T> items) => items.Count > 0;
}
