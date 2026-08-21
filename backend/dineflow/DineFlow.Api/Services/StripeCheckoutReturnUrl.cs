namespace DineFlow.Api.Services;

/// <summary>
/// Builds the Stripe Checkout return URLs.
///
/// <para>
/// <c>{CHECKOUT_SESSION_ID}</c> is a literal template that Stripe substitutes when it redirects
/// the customer back. It must reach Stripe with its braces intact: percent-encoding them to
/// <c>%7BCHECKOUT_SESSION_ID%7D</c> — which is exactly what <c>QueryHelpers.AddQueryString</c>
/// does to a value — leaves Stripe with nothing to substitute, so the browser arrives carrying the
/// encoded template instead of a session id and the success page can never confirm the payment.
/// </para>
///
/// <para>
/// This lives in one place because the same URL was being assembled in four, and two of the four
/// got the encoding wrong.
/// </para>
/// </summary>
public static class StripeCheckoutReturnUrl
{
    /// <summary>The literal Stripe substitutes with the real session id. Never URL-encode it.</summary>
    public const string SessionIdPlaceholder = "{CHECKOUT_SESSION_ID}";

    private const string DefaultSuccessUrl = "http://localhost:5173/payment/success";

    /// <summary>
    /// Returns <paramref name="url"/> carrying <c>session_id={CHECKOUT_SESSION_ID}</c>, appended by
    /// string concatenation so the braces survive. Already-templated URLs are left alone, and a
    /// blank URL falls back to <paramref name="fallbackUrl"/> so a missing setting still produces
    /// something Stripe will accept.
    /// </summary>
    public static string WithSessionId(string? url, string fallbackUrl = DefaultSuccessUrl)
    {
        var target = string.IsNullOrWhiteSpace(url) ? fallbackUrl : url.Trim();

        if (target.Contains(SessionIdPlaceholder, StringComparison.Ordinal))
        {
            return target;
        }

        var separator = target.Contains('?') ? '&' : '?';
        return $"{target}{separator}session_id={SessionIdPlaceholder}";
    }
}
