namespace DineFlow.Api.Services;

public static class PlatformFeeCalculator
{
    public static long CalculateOrderFee(long amountCents, int feeBasisPoints)
    {
        if (amountCents <= 1 || feeBasisPoints <= 0)
        {
            return 0;
        }

        var calculated = decimal.Round(
            amountCents * feeBasisPoints / 10_000m,
            0,
            MidpointRounding.AwayFromZero);

        // Stripe requires an application fee to be lower than the charge amount.
        return Math.Min((long)calculated, amountCents - 1);
    }
}
