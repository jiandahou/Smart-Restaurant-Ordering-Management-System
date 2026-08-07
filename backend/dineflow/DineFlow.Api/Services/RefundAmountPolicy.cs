namespace DineFlow.Api.Services;

public static class RefundAmountPolicy
{
    public static bool IsValidOverrideAmount(long? amountCents) =>
        amountCents is null || amountCents > 0;

    public static bool IsWithinRequestedAmount(long requestedAmountCents, long approvedAmountCents) =>
        approvedAmountCents > 0 && approvedAmountCents <= requestedAmountCents;
}
