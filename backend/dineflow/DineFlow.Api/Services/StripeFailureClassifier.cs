using System.Net;

namespace DineFlow.Api.Services;

public enum StripeFailureKind
{
    /// Stripe answered and refused. The money definitely did not move.
    Declined,

    /// We never got a usable answer — timeout, dropped connection, 5xx, rate limit. Stripe may
    /// well have processed the request, so treating this as a failure is how you double-refund.
    Indeterminate
}

public static class StripeFailureClassifier
{
    /// <param name="httpStatusCode">Null or 0 when no HTTP response was received at all.</param>
    /// <param name="hasStripeError">True when Stripe returned a structured error body.</param>
    public static StripeFailureKind Classify(HttpStatusCode? httpStatusCode, bool hasStripeError)
    {
        // No response reached us, so nothing can be concluded about what Stripe did.
        if (httpStatusCode is null or 0)
        {
            return StripeFailureKind.Indeterminate;
        }

        var status = (int)httpStatusCode.Value;

        // Stripe's own side failed after possibly accepting the request.
        if (status >= 500)
        {
            return StripeFailureKind.Indeterminate;
        }

        // Timeout and throttling can both land after the work was already started.
        if (status is 408 or 429)
        {
            return StripeFailureKind.Indeterminate;
        }

        // A 4xx carrying a structured Stripe error is a real, final refusal.
        return hasStripeError ? StripeFailureKind.Declined : StripeFailureKind.Indeterminate;
    }
}
