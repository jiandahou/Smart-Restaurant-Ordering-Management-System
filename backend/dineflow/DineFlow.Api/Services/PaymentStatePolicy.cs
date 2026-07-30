using DineFlow.Infrastructure.Payments;

namespace DineFlow.Api.Services;

public static class PaymentStatePolicy
{
    public static bool CanApplyProviderStatus(PaymentStatus current, PaymentStatus incoming)
    {
        if (current is PaymentStatus.Refunded or PaymentStatus.PartiallyRefunded)
        {
            return false;
        }

        if (current == PaymentStatus.Paid)
        {
            return incoming == PaymentStatus.Paid;
        }

        return incoming switch
        {
            PaymentStatus.Pending => current == PaymentStatus.Pending,
            PaymentStatus.Paid => true,
            PaymentStatus.Failed or PaymentStatus.Expired or PaymentStatus.Cancelled =>
                current is PaymentStatus.Pending or PaymentStatus.Unpaid or PaymentStatus.Failed or PaymentStatus.Expired,
            _ => false
        };
    }

    public static bool CanApplyOrderStatus(PaymentStatus current, PaymentStatus incoming) =>
        CanApplyProviderStatus(current, incoming);
}
