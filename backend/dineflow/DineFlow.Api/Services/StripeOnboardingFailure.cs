using Microsoft.AspNetCore.Http;
using Stripe;

namespace DineFlow.Api.Services;

/// <summary>
/// Turns a rejected Connect onboarding attempt into something the person reading it can act on.
/// </summary>
/// <remarks>
/// <para>
/// Everything that was not a half-finished Connect platform used to come back as "Stripe could not
/// start restaurant onboarding. Please try again." Some of those failures never resolve: Stripe does
/// not operate in every country, and a restaurant registered in one it does not serve will be
/// refused today, tomorrow, and from a different computer. Telling that person to try again sends
/// them round a loop with no exit, and hides the one fact that would let them fix it.
/// </para>
/// <para>
/// The provider's own wording is not passed through. It is written for developers, and an error
/// from a payment processor is exactly the kind of text a customer should not be reading raw.
/// </para>
/// </remarks>
public readonly record struct StripeOnboardingFailure(int StatusCode, string Message, string Code)
{
    /// <summary>Stripe's code for a country it does not operate in.</summary>
    private const string CountryUnsupported = "country_unsupported";

    public static StripeOnboardingFailure Describe(StripeException exception, string? countryCode)
    {
        var providerMessage = exception.StripeError?.Message ?? exception.Message;

        // The platform account itself is not finished, which the operator fixes in their own Stripe
        // dashboard rather than here.
        if (providerMessage.Contains("signed up for Connect", StringComparison.OrdinalIgnoreCase))
        {
            return new StripeOnboardingFailure(
                StatusCodes.Status409Conflict,
                "Stripe Connect platform setup is incomplete. Finish the business information "
                    + "section in the Stripe Connect setup guide, then try again.",
                "stripe_connect_setup_incomplete");
        }

        if (string.Equals(exception.StripeError?.Code, CountryUnsupported, StringComparison.OrdinalIgnoreCase))
        {
            var country = string.IsNullOrWhiteSpace(countryCode)
                ? "this restaurant's country"
                : countryCode.Trim().ToUpperInvariant();

            // 409, not 502: nothing is wrong with Stripe, and nothing about waiting will change it.
            return new StripeOnboardingFailure(
                StatusCodes.Status409Conflict,
                $"Stripe does not operate in {country}, so this restaurant cannot take online "
                    + "payments. Change the restaurant's country to one Stripe supports, or keep "
                    + "it on counter payment.",
                "stripe_country_unsupported");
        }

        return new StripeOnboardingFailure(
            StatusCodes.Status502BadGateway,
            "Stripe could not start restaurant onboarding. Please try again.",
            "stripe_onboarding_failed");
    }
}
