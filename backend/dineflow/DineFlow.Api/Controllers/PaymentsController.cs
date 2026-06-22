using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Options;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/payments")]
[Authorize]
public class PaymentsController : ControllerBase
{
    private const string OrderIdMetadataKey = "orderId";
    private const string PaymentIdMetadataKey = "paymentId";

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        ILogger<PaymentsController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _logger = logger;
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("checkout-session/order")]
    public async Task<ActionResult<CreateCheckoutSessionResponse>> CreateOrderCheckoutSession(
        CreateOrderCheckoutSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe is not configured."
            });
        }

        if (request.OrderId == Guid.Empty)
        {
            return BadRequest(new
            {
                message = "OrderId is required."
            });
        }

        var order = await _dbContext.Orders
            .Include(currentOrder => currentOrder.OrderItems)
            .Include(currentOrder => currentOrder.Restaurant)
            .FirstOrDefaultAsync(currentOrder => currentOrder.Id == request.OrderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!await CanAccessRestaurantAsync(order.RestaurantId))
        {
            return Forbid();
        }

        if (order.OrderItems.Count == 0)
        {
            return BadRequest(new { message = "Order has no items to pay for." });
        }

        if (order.PaymentStatus == PaymentStatus.Paid)
        {
            return Conflict(new { message = "This order has already been paid." });
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return BadRequest(new { message = "Cancelled or rejected orders cannot be paid." });
        }

        var menuItemIdsForNameFallback = order.OrderItems
            .Where(item => string.IsNullOrWhiteSpace(item.MenuItemNameSnapshot) && item.MenuItemId.HasValue)
            .Select(item => item.MenuItemId!.Value)
            .Distinct()
            .ToArray();

        var menuItemNamesById = menuItemIdsForNameFallback.Length == 0
            ? new Dictionary<Guid, string>()
            : await _dbContext.MenuItems
                .Where(menuItem => menuItemIdsForNameFallback.Contains(menuItem.Id))
                .Select(menuItem => new
                {
                    menuItem.Id,
                    menuItem.Name
                })
                .ToDictionaryAsync(menuItem => menuItem.Id, menuItem => menuItem.Name, cancellationToken);

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = User.FindFirstValue(ClaimTypes.Email);
        var currency = NormalizeCurrency(order.Restaurant?.Currency ?? _stripeOptions.Currency);
        var payment = new Payment
        {
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            AmountCents = ConvertAmountToCents(order.TotalAmount),
            Currency = currency,
            Status = PaymentStatus.Pending
        };

        _dbContext.Payments.Add(payment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AddCheckoutSessionId(_stripeOptions.SuccessUrl),
            CancelUrl = _stripeOptions.CancelUrl,
            CustomerEmail = string.IsNullOrWhiteSpace(email) ? null : email,
            LineItems = order.OrderItems
                .OrderBy(item => item.CreatedAt)
                .ThenBy(item => item.Id)
                .Select(item => new SessionLineItemOptions
                {
                    Quantity = item.Quantity,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = currency,
                        UnitAmount = ConvertAmountToCents(item.UnitPrice),
                        ProductData = new SessionLineItemPriceDataProductDataOptions
                        {
                            Name = ResolveStripeProductName(item, menuItemNamesById)
                        }
                    }
                })
                .ToList(),
            Metadata = new Dictionary<string, string>
            {
                ["mode"] = "order",
                ["userId"] = userId ?? string.Empty,
                [OrderIdMetadataKey] = order.Id.ToString(),
                [PaymentIdMetadataKey] = payment.Id.ToString()
            },
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                Metadata = new Dictionary<string, string>
                {
                    ["mode"] = "order",
                    ["userId"] = userId ?? string.Empty,
                    [OrderIdMetadataKey] = order.Id.ToString(),
                    [PaymentIdMetadataKey] = payment.Id.ToString()
                }
            }
        };

        try
        {
            var service = new SessionService(_stripeClient);
            var session = await service.CreateAsync(sessionOptions, cancellationToken: cancellationToken);

            payment.ProviderCheckoutSessionId = session.Id;
            payment.ProviderPaymentIntentId = session.PaymentIntentId;
            payment.UpdatedAt = DateTime.UtcNow;
            order.PaymentStatus = PaymentStatus.Pending;
            order.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return Ok(new CreateCheckoutSessionResponse
            {
                Message = "Checkout session created.",
                SessionId = session.Id,
                CheckoutUrl = session.Url,
                OrderId = order.Id,
                PaymentId = payment.Id
            });
        }
        catch (StripeException ex)
        {
            _logger.LogError(ex, "Stripe failed to create a checkout session for order {OrderId}.", order.Id);

            payment.Status = PaymentStatus.Failed;
            payment.FailureReason = ex.StripeError?.Message ?? ex.Message;
            payment.FailedAt = DateTime.UtcNow;
            payment.UpdatedAt = DateTime.UtcNow;
            order.PaymentStatus = PaymentStatus.Failed;
            order.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return BadRequest(new
            {
                message = "Failed to create Stripe checkout session.",
                detail = ex.StripeError?.Message ?? ex.Message
            });
        }
    }

    [AllowAnonymous]
    [HttpPost("stripe/webhook")]
    public async Task<IActionResult> StripeWebhook(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.WebhookSecret))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe webhook secret is not configured."
            });
        }

        var payload = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync(cancellationToken);
        var signatureHeader = Request.Headers["Stripe-Signature"].ToString();
        Event stripeEvent;

        try
        {
            stripeEvent = EventUtility.ConstructEvent(
                payload,
                signatureHeader,
                _stripeOptions.WebhookSecret);
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(ex, "Rejected Stripe webhook with invalid signature.");

            return BadRequest(new
            {
                message = "Invalid Stripe webhook signature."
            });
        }

        switch (stripeEvent.Type)
        {
            case "checkout.session.completed":
                await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, PaymentStatus.Paid, cancellationToken);
                break;
            case "checkout.session.expired":
                await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, PaymentStatus.Expired, cancellationToken);
                break;
            case "payment_intent.payment_failed":
                await UpdatePaymentFromPaymentIntentAsync(stripeEvent, PaymentStatus.Failed, cancellationToken);
                break;
            default:
                _logger.LogInformation("Ignored Stripe webhook event {EventType}.", stripeEvent.Type);
                break;
        }

        return Ok(new
        {
            received = true
        });
    }

    private static string NormalizeCurrency(string? currency)
    {
        return string.IsNullOrWhiteSpace(currency)
            ? "aud"
            : currency.Trim().ToLowerInvariant();
    }

    private static long ConvertAmountToCents(decimal amount)
    {
        return Convert.ToInt64(Math.Round(amount * 100m, MidpointRounding.AwayFromZero));
    }

    private static string ResolveStripeProductName(
        OrderItem item,
        IReadOnlyDictionary<Guid, string> menuItemNamesById)
    {
        if (!string.IsNullOrWhiteSpace(item.MenuItemNameSnapshot))
        {
            return item.MenuItemNameSnapshot.Trim();
        }

        if (item.MenuItemId.HasValue &&
            menuItemNamesById.TryGetValue(item.MenuItemId.Value, out var menuItemName) &&
            !string.IsNullOrWhiteSpace(menuItemName))
        {
            return menuItemName.Trim();
        }

        return "Menu item";
    }

    private static string AddCheckoutSessionId(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return "http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}";
        }

        var separator = url.Contains('?') ? '&' : '?';

        return url.Contains("{CHECKOUT_SESSION_ID}", StringComparison.Ordinal)
            ? url
            : $"{url}{separator}session_id={{CHECKOUT_SESSION_ID}}";
    }

    private async Task UpdatePaymentFromCheckoutSessionAsync(
        Event stripeEvent,
        PaymentStatus status,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Session session)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a checkout session.", stripeEvent.Type);
            return;
        }

        var payment = await FindPaymentBySessionAsync(session.Metadata, session.Id, cancellationToken);

        if (payment is null)
        {
            _logger.LogWarning("No payment found for Stripe checkout session {SessionId}.", session.Id);
            return;
        }

        payment.Status = status;
        payment.ProviderCheckoutSessionId = session.Id;
        payment.ProviderPaymentIntentId = session.PaymentIntentId;
        payment.UpdatedAt = DateTime.UtcNow;

        if (status == PaymentStatus.Paid)
        {
            payment.PaidAt = DateTime.UtcNow;
            payment.FailedAt = null;
            payment.FailureReason = null;
        }

        if (payment.Order is not null)
        {
            payment.Order.PaymentStatus = status;
            payment.Order.UpdatedAt = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation(
            "Updated payment {PaymentId} to {Status} from Stripe checkout session {SessionId}.",
            payment.Id,
            status,
            session.Id);
    }

    private async Task UpdatePaymentFromPaymentIntentAsync(
        Event stripeEvent,
        PaymentStatus status,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not PaymentIntent paymentIntent)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a payment intent.", stripeEvent.Type);
            return;
        }

        var payment = await FindPaymentByPaymentIntentAsync(paymentIntent.Metadata, paymentIntent.Id, cancellationToken);

        if (payment is null)
        {
            _logger.LogWarning("No payment found for Stripe payment intent {PaymentIntentId}.", paymentIntent.Id);
            return;
        }

        payment.Status = status;
        payment.ProviderPaymentIntentId = paymentIntent.Id;
        payment.FailureReason = paymentIntent.LastPaymentError?.Message;
        payment.FailedAt = DateTime.UtcNow;
        payment.UpdatedAt = DateTime.UtcNow;

        if (payment.Order is not null && payment.Order.PaymentStatus != PaymentStatus.Paid)
        {
            payment.Order.PaymentStatus = status;
            payment.Order.UpdatedAt = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation(
            "Updated payment {PaymentId} to {Status} from Stripe payment intent {PaymentIntentId}.",
            payment.Id,
            status,
            paymentIntent.Id);
    }

    private async Task<Payment?> FindPaymentBySessionAsync(
        IReadOnlyDictionary<string, string> metadata,
        string sessionId,
        CancellationToken cancellationToken)
    {
        if (metadata.TryGetValue(PaymentIdMetadataKey, out var paymentId) &&
            Guid.TryParse(paymentId, out var parsedPaymentId))
        {
            var paymentById = await _dbContext.Payments
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(currentPayment => currentPayment.Id == parsedPaymentId, cancellationToken);

            if (paymentById is not null)
            {
                return paymentById;
            }
        }

        return await _dbContext.Payments
            .Include(currentPayment => currentPayment.Order)
            .FirstOrDefaultAsync(
                currentPayment => currentPayment.ProviderCheckoutSessionId == sessionId,
                cancellationToken);
    }

    private async Task<Payment?> FindPaymentByPaymentIntentAsync(
        IReadOnlyDictionary<string, string> metadata,
        string paymentIntentId,
        CancellationToken cancellationToken)
    {
        if (metadata.TryGetValue(PaymentIdMetadataKey, out var paymentId) &&
            Guid.TryParse(paymentId, out var parsedPaymentId))
        {
            var paymentById = await _dbContext.Payments
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(currentPayment => currentPayment.Id == parsedPaymentId, cancellationToken);

            if (paymentById is not null)
            {
                return paymentById;
            }
        }

        return await _dbContext.Payments
            .Include(currentPayment => currentPayment.Order)
            .FirstOrDefaultAsync(
                currentPayment => currentPayment.ProviderPaymentIntentId == paymentIntentId,
                cancellationToken);
    }

    private async Task<Guid?> GetCurrentRestaurantIdAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return null;
        }

        var currentUser = await _userManager.FindByIdAsync(currentUserId);
        return currentUser?.RestaurantId;
    }

    private async Task<bool> CanAccessRestaurantAsync(Guid? restaurantId)
    {
        if (restaurantId is null)
        {
            return false;
        }

        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        return await GetCurrentRestaurantIdAsync() == restaurantId.Value;
    }
}
