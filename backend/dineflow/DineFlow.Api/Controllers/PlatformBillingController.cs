using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Billing;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

/// <summary>What a restaurant pays the platform, and how it pays.</summary>
/// <remarks>
/// Its own controller rather than more of <see cref="RestaurantController"/>, which is already past
/// a thousand lines and is about restaurants rather than about money owed for them.
/// </remarks>
[ApiController]
[Route("api/restaurant/{restaurantId:guid}/billing")]
[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public class PlatformBillingController(
    AppDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    PlatformSubscriptionService subscriptions,
    ReportLogWriter reportLogWriter,
    ILogger<PlatformBillingController> logger) : ControllerBase
{
    /// <summary>
    /// Starts, or hands back, the checkout that begins this restaurant's subscription.
    /// </summary>
    /// <remarks>
    /// Reachable by the restaurant's own admins, not only the platform owner: the person who has to
    /// pay should not have to ask somebody else to generate a link for them. Setting the price is
    /// the platform owner's, and stays that way.
    /// </remarks>
    [HttpPost("subscription/checkout")]
    public async Task<ActionResult<PlatformFeeCheckoutResponse>> StartSubscriptionCheckout(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        if (!subscriptions.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Stripe is not configured." });
        }

        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == restaurantId, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (restaurant.PlatformBillingModel != PlatformBillingModel.Subscription ||
            string.IsNullOrWhiteSpace(restaurant.PlatformSubscriptionPriceId))
        {
            return Conflict(new
            {
                message = "This restaurant is not on a subscription plan. Ask DineFlow to assign one.",
            });
        }

        if (restaurant.BillingStandingIsHealthy())
        {
            return Ok(new PlatformFeeCheckoutResponse
            {
                Message = "This subscription is already active.",
                Required = true,
                Paid = true,
            });
        }

        var ownerEmail = await ResolveOwnerEmailAsync(restaurantId, cancellationToken);
        var customerId = await subscriptions.EnsureCustomerAsync(restaurant, ownerEmail, cancellationToken);
        var session = await subscriptions.StartCheckoutAsync(
            restaurant,
            restaurant.PlatformSubscriptionPriceId,
            customerId,
            cancellationToken);

        reportLogWriter.AddAudit(
            "Restaurant.SubscriptionCheckoutCreated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Created a subscription checkout for {restaurant.Name}.",
            after: new { sessionId = session.Id, restaurant.PlatformSubscriptionPriceId });
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new PlatformFeeCheckoutResponse
        {
            Message = "Subscription checkout created.",
            Required = true,
            Paid = false,
            CheckoutUrl = session.Url,
            SessionId = session.Id,
        });
    }

    /// <summary>
    /// A link into Stripe's billing portal, where cards, invoices and cancellation live.
    /// </summary>
    /// <remarks>
    /// Handing this to Stripe rather than building it means no card number ever reaches DineFlow,
    /// and the invoice history a restaurant will eventually ask for is already there.
    /// </remarks>
    [HttpPost("portal")]
    public async Task<ActionResult<PlatformFeeCheckoutResponse>> StartBillingPortal(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        if (!subscriptions.IsConfigured)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Stripe is not configured." });
        }

        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == restaurantId, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (string.IsNullOrWhiteSpace(restaurant.PlatformStripeCustomerId))
        {
            return Conflict(new
            {
                message = "There is nothing to manage yet — this restaurant has never been billed.",
            });
        }

        var session = await subscriptions.StartPortalAsync(
            restaurant.PlatformStripeCustomerId,
            cancellationToken);

        return Ok(new PlatformFeeCheckoutResponse
        {
            Message = "Billing portal opened.",
            Required = true,
            Paid = false,
            CheckoutUrl = session.Url,
        });
    }

    /// <summary>
    /// Re-reads this restaurant's billing straight from Stripe, now.
    /// </summary>
    /// <remarks>
    /// The escape hatch for the failure this whole design is shaped around: a payment that was made
    /// and whose webhook never arrived. The sweep would find it within the hour, but somebody
    /// staring at a warning that says their ordering is about to stop should not have to wait, and
    /// should not have to ask anyone.
    /// </remarks>
    [HttpPost("sync")]
    public async Task<ActionResult<RestaurantBillingStandingResponse>> SyncBilling(
        Guid restaurantId,
        [FromServices] PlatformBillingReconciliationService reconciliation,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == restaurantId, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        await reconciliation.ReconcileOneAsync(restaurant, reportLogWriter, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        return Ok(PlatformBillingPresenter.Describe(restaurant, DateTime.UtcNow));
    }

    /// <summary>
    /// Puts a restaurant on a billing model, and says when enforcement begins.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The platform owner's alone, because it is the act that can eventually take a restaurant
    /// offline. The enforcement date is refused unless it is at least a grace period away: the month
    /// is a promise, and it should not be possible to break it with a typo.
    /// </para>
    /// <para>
    /// Moving a restaurant off billing clears the clock and any suspension, so the way back is
    /// always open.
    /// </para>
    /// </remarks>
    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPatch("plan")]
    public async Task<ActionResult<RestaurantBillingStandingResponse>> SetPlan(
        Guid restaurantId,
        PlatformBillingPlanRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<PlatformBillingModel>(request.Model, ignoreCase: true, out var model))
        {
            return BadRequest(new
            {
                message = "Unknown billing model.",
                allowedValues = Enum.GetNames<PlatformBillingModel>(),
            });
        }

        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == restaurantId, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var now = DateTime.UtcNow;

        if (model == PlatformBillingModel.Subscription && string.IsNullOrWhiteSpace(request.PriceId))
        {
            return BadRequest(new { message = "A subscription needs a Stripe price." });
        }

        if (request.EnforcedFrom is DateTime enforcedFrom &&
            enforcedFrom < now + PlatformBilling.GracePeriod)
        {
            return BadRequest(new
            {
                message =
                    "Enforcement must start at least a full grace period from now, so the "
                    + "restaurant gets the notice it was promised.",
                earliest = now + PlatformBilling.GracePeriod,
            });
        }

        var before = new
        {
            model = restaurant.PlatformBillingModel.ToString(),
            priceId = restaurant.PlatformSubscriptionPriceId,
            enforcedFrom = restaurant.PlatformBillingEnforcedFrom,
        };

        restaurant.PlatformBillingModel = model;
        restaurant.PlatformBillingEnforcedFrom = request.EnforcedFrom;
        restaurant.UpdatedAt = now;

        if (model == PlatformBillingModel.Subscription)
        {
            restaurant.PlatformSubscriptionPriceId = request.PriceId;
        }

        if (model == PlatformBillingModel.None)
        {
            // Owing nothing means no clock and no suspension, immediately.
            restaurant.PlatformBillingDelinquentSince = null;
            restaurant.PlatformBillingSuspendedAt = null;
            restaurant.PlatformBillingEnforcedFrom = null;
        }

        reportLogWriter.AddAudit(
            "Restaurant.BillingModelChanged",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Set {restaurant.Name} to {model} billing.",
            before: before,
            after: new
            {
                model = model.ToString(),
                priceId = restaurant.PlatformSubscriptionPriceId,
                enforcedFrom = restaurant.PlatformBillingEnforcedFrom,
            });
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Restaurant {RestaurantId} moved to {Model} billing.",
            restaurant.Id,
            model);

        return Ok(PlatformBillingPresenter.Describe(restaurant, now));
    }

    private async Task<string?> ResolveOwnerEmailAsync(Guid restaurantId, CancellationToken cancellationToken) =>
        await dbContext.Users
            .Where(user => user.RestaurantId == restaurantId && user.Email != null)
            .OrderBy(user => user.CreatedAt)
            .Select(user => user.Email)
            .FirstOrDefaultAsync(cancellationToken);

    private async Task<bool> CanAccessRestaurantAsync(Guid restaurantId)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(userId))
        {
            return false;
        }

        var currentUser = await userManager.FindByIdAsync(userId);
        return currentUser?.RestaurantId == restaurantId;
    }
}

/// <summary>What the platform owner is putting this restaurant on.</summary>
public class PlatformBillingPlanRequest
{
    /// <summary>"None", "OneTimeActivation" or "Subscription".</summary>
    public string Model { get; set; } = "None";

    /// <summary>The Stripe price to subscribe to. Required for a subscription.</summary>
    public string? PriceId { get; set; }

    /// <summary>
    /// When enforcement begins for this restaurant. Null means never, which is the safe default.
    /// </summary>
    public DateTime? EnforcedFrom { get; set; }
}
