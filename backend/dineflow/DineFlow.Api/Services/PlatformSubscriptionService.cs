using DineFlow.Api.Options;
using DineFlow.Infrastructure.Billing;
using Microsoft.Extensions.Options;
using Stripe;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using CheckoutSession = Stripe.Checkout.Session;
using CheckoutSessionService = Stripe.Checkout.SessionService;
using PortalSession = Stripe.BillingPortal.Session;
using PortalSessionService = Stripe.BillingPortal.SessionService;

namespace DineFlow.Api.Services;

/// <summary>
/// The platform's own subscription billing, run on the platform's Stripe account.
/// </summary>
/// <remarks>
/// <para>
/// Nothing here touches Connect. A diner paying a restaurant is a direct charge on the restaurant's
/// connected account; a restaurant paying the platform is an ordinary charge on the platform's own,
/// which is why these requests carry no <c>StripeAccount</c>.
/// </para>
/// <para>
/// Deliberately thin. Retry ladders after a declined card, the emails that go with them, letting
/// somebody update an expiring card, prorating a mid-period change — Stripe Billing does all of it,
/// and the portal handles cards without a card number ever reaching DineFlow. Reimplementing that
/// would be a dunning system nobody asked for, kept in step with Stripe's by hand.
/// </para>
/// </remarks>
public sealed class PlatformSubscriptionService(
    IStripeClient stripeClient,
    IOptions<StripeOptions> stripeOptions,
    ILogger<PlatformSubscriptionService> logger)
{
    /// <summary>The metadata marker that tells a subscription checkout apart from every other one.</summary>
    public const string SessionMode = "restaurant_platform_subscription";

    private readonly StripeOptions _options = stripeOptions.Value;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_options.SecretKey);

    /// <summary>
    /// This restaurant's Stripe customer, created once and reused forever after.
    /// </summary>
    /// <remarks>
    /// Checkout mints its own customer when it is not handed one. A second attempt would then make
    /// a second customer, the subscription would sit on that one, and the billing portal — opened
    /// against whichever id we happened to store — would show a card the restaurant is not being
    /// charged on. The idempotency key means two racing requests still produce one customer.
    /// </remarks>
    public async Task<string> EnsureCustomerAsync(
        RestaurantEntity restaurant,
        string? ownerEmail,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(restaurant.PlatformStripeCustomerId))
        {
            return restaurant.PlatformStripeCustomerId;
        }

        var customer = await new CustomerService(stripeClient).CreateAsync(
            new CustomerCreateOptions
            {
                Name = restaurant.Name,
                Email = string.IsNullOrWhiteSpace(ownerEmail) ? null : ownerEmail,
                Metadata = new Dictionary<string, string>
                {
                    ["restaurantId"] = restaurant.Id.ToString(),
                    ["restaurantName"] = restaurant.Name,
                },
            },
            new RequestOptions { IdempotencyKey = $"restaurant-billing-customer-{restaurant.Id:N}" },
            cancellationToken);

        restaurant.PlatformStripeCustomerId = customer.Id;
        return customer.Id;
    }

    /// <summary>
    /// A hosted checkout that starts the subscription, or the one already waiting to be paid.
    /// </summary>
    /// <remarks>
    /// The reuse guard matters for the same reason it does on the activation fee: minting a second
    /// payable link every time somebody clicks leaves a restaurant holding two, and paying the
    /// wrong one is indistinguishable from paying the right one until the subscription arrives
    /// twice.
    /// </remarks>
    public async Task<CheckoutSession> StartCheckoutAsync(
        RestaurantEntity restaurant,
        string priceId,
        string customerId,
        CancellationToken cancellationToken)
    {
        var metadata = new Dictionary<string, string>
        {
            ["mode"] = SessionMode,
            ["restaurantId"] = restaurant.Id.ToString(),
        };

        restaurant.PlatformSubscriptionIdempotencyKey =
            $"restaurant-subscription-{restaurant.Id:N}-{priceId}";

        var session = await new CheckoutSessionService(stripeClient).CreateAsync(
            new Stripe.Checkout.SessionCreateOptions
            {
                Mode = "subscription",
                Customer = customerId,
                SuccessUrl = AppendRestaurantId(_options.SubscriptionSuccessUrl, restaurant.Id),
                CancelUrl = AppendRestaurantId(_options.SubscriptionCancelUrl, restaurant.Id),
                LineItems = [new Stripe.Checkout.SessionLineItemOptions { Price = priceId, Quantity = 1 }],
                Metadata = metadata,
                // Carried onto the subscription itself, so its own events can be attributed even
                // when the customer lookup misses.
                SubscriptionData = new Stripe.Checkout.SessionSubscriptionDataOptions { Metadata = metadata },
            },
            new RequestOptions { IdempotencyKey = restaurant.PlatformSubscriptionIdempotencyKey },
            cancellationToken);

        restaurant.PlatformSubscriptionCheckoutSessionId = session.Id;
        restaurant.PlatformSubscriptionCheckoutUrl = session.Url;
        restaurant.PlatformSubscriptionPriceId = priceId;
        return session;
    }

    /// <summary>
    /// A link into Stripe's own billing portal, where cards and cancellations are handled.
    /// </summary>
    public async Task<PortalSession> StartPortalAsync(
        string customerId,
        CancellationToken cancellationToken) =>
        await new PortalSessionService(stripeClient).CreateAsync(
            new Stripe.BillingPortal.SessionCreateOptions
            {
                Customer = customerId,
                ReturnUrl = _options.BillingPortalReturnUrl,
            },
            cancellationToken: cancellationToken);

    /// <summary>
    /// Copies a Stripe subscription onto the restaurant.
    /// </summary>
    /// <remarks>
    /// Facts only. What they mean for whether the restaurant may trade is decided by the
    /// reconciliation sweep, which sees all of them at once and so cannot be confused by events
    /// arriving out of order.
    /// </remarks>
    public static void ApplySubscription(
        RestaurantEntity restaurant,
        Subscription subscription,
        DateTime utcNow)
    {
        restaurant.PlatformSubscriptionId = subscription.Id;
        restaurant.PlatformSubscriptionStatus = subscription.Status;
        restaurant.PlatformSubscriptionCancelAtPeriodEnd = subscription.CancelAtPeriodEnd;
        restaurant.PlatformSubscriptionCurrentPeriodEndAt = CurrentPeriodEnd(subscription);
        restaurant.PlatformSubscriptionPriceId =
            subscription.Items?.Data?.FirstOrDefault()?.Price?.Id
            ?? restaurant.PlatformSubscriptionPriceId;
        restaurant.PlatformBillingSyncedAt = utcNow;
        restaurant.UpdatedAt = utcNow;

        if (!string.IsNullOrWhiteSpace(subscription.CustomerId))
        {
            restaurant.PlatformStripeCustomerId = subscription.CustomerId;
        }

        // A paid-up subscription clears the clock in the same write, without waiting for a sweep.
        // Nothing here starts one — that is the sweep's alone.
        if (restaurant.BillingStandingIsHealthy())
        {
            restaurant.PlatformBillingDelinquentSince = null;
            restaurant.PlatformBillingSuspendedAt = null;
        }
    }

    /// <summary>
    /// The end of the period a subscription has been paid for.
    /// </summary>
    /// <remarks>
    /// Stripe moved this from the subscription onto its items. Reading both means the field keeps
    /// working across the library version that makes the change, rather than silently becoming null
    /// and taking the renewal date off the screen with it.
    /// </remarks>
    private static DateTime? CurrentPeriodEnd(Subscription subscription) =>
        subscription.Items?.Data?.FirstOrDefault()?.CurrentPeriodEnd;

    public async Task<Subscription?> FetchSubscriptionAsync(
        string subscriptionId,
        CancellationToken cancellationToken)
    {
        try
        {
            return await new SubscriptionService(stripeClient).GetAsync(
                subscriptionId,
                cancellationToken: cancellationToken);
        }
        catch (StripeException ex)
        {
            logger.LogWarning(ex, "Could not read Stripe subscription {SubscriptionId}.", subscriptionId);
            return null;
        }
    }

    private static string AppendRestaurantId(string url, Guid restaurantId)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return url;
        }

        var separator = url.Contains('?', StringComparison.Ordinal) ? '&' : '?';
        return $"{url}{separator}restaurantId={restaurantId}";
    }
}
