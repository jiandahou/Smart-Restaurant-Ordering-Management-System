using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Extensions;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

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
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        ILogger<PaymentsController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _logger = logger;
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet]
    public async Task<ActionResult<PagedResponse<AdminPaymentResponse>>> GetPayments(
        [FromQuery] AdminPaymentListRequest request,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Current user is not assigned to a restaurant."
            });
        }

        var query = _dbContext.Payments
            .AsNoTracking()
            .Include(payment => payment.Order)
                .ThenInclude(order => order!.Restaurant)
            .Include(payment => payment.Order)
                .ThenInclude(order => order!.Customer)
            .AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(payment => payment.Order != null && payment.Order.RestaurantId == currentRestaurantId);
        }

        if (request.RestaurantId.HasValue)
        {
            query = query.Where(payment => payment.Order != null && payment.Order.RestaurantId == request.RestaurantId);
        }

        if (!TryParseFilter<PaymentStatus>(request.Status, nameof(request.Status), out var paymentStatus, out var filterError) ||
            !TryParseFilter<OrderStatus>(request.OrderStatus, nameof(request.OrderStatus), out var orderStatus, out filterError) ||
            !TryParseFilter<OrderType>(request.OrderType, nameof(request.OrderType), out var orderType, out filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (paymentStatus.HasValue)
        {
            query = query.Where(payment => payment.Status == paymentStatus.Value);
        }

        if (orderStatus.HasValue)
        {
            query = query.Where(payment => payment.Order != null && payment.Order.Status == orderStatus.Value);
        }

        if (orderType.HasValue)
        {
            query = query.Where(payment => payment.Order != null && payment.Order.OrderType == orderType.Value);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(payment =>
                EF.Functions.ILike(payment.Id.ToString(), pattern) ||
                (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern)) ||
                (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern)) ||
                (payment.Order != null && EF.Functions.ILike(payment.Order.OrderNumber, pattern)) ||
                (payment.Order != null && payment.Order.Restaurant != null && EF.Functions.ILike(payment.Order.Restaurant.Name, pattern)) ||
                (payment.Order != null && payment.Order.Customer != null && payment.Order.Customer.FullName != null && EF.Functions.ILike(payment.Order.Customer.FullName, pattern)) ||
                (payment.Order != null && payment.Order.Customer != null && payment.Order.Customer.Email != null && EF.Functions.ILike(payment.Order.Customer.Email, pattern)));
        }

        var sortedQuery = ApplyPaymentSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "updatedAt", "orderNumber", "restaurantName", "status", "amount" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(new PagedResponse<AdminPaymentResponse>
        {
            Items = page.Items.Select(MapToAdminPaymentResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [AllowAnonymous]
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
            .Include(currentOrder => currentOrder.Table)
            .FirstOrDefaultAsync(currentOrder => currentOrder.Id == request.OrderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!await CanStartCheckoutSessionForOrderAsync(order))
        {
            if (User.Identity?.IsAuthenticated != true)
            {
                return Unauthorized(new { message = "Sign in to continue payment for this order." });
            }

            return Forbid();
        }

        if (order.OrderItems.Count == 0)
        {
            return BadRequest(new { message = "Order has no items to pay for." });
        }

        if (order.PaymentStatus is PaymentStatus.Paid
            or PaymentStatus.Refunded
            or PaymentStatus.PartiallyRefunded
            or PaymentStatus.NotRequired)
        {
            return Conflict(new { message = "This order cannot be paid online." });
        }

        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return Conflict(new { message = "This order is configured for payment at the counter." });
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
            AmountCents = PricingCalculator.ToMinorCurrencyUnits(order.TotalAmount),
            Currency = currency,
            Status = PaymentStatus.Pending
        };

        _dbContext.Payments.Add(payment);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var returnTo = NormalizeMenuReturnPath(request.ReturnTo);
        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AddCheckoutSessionId(AddReturnToUrl(_stripeOptions.SuccessUrl, returnTo)),
            CancelUrl = AddReturnToUrl(_stripeOptions.CancelUrl, returnTo),
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
                        UnitAmount = PricingCalculator.ToMinorCurrencyUnits(item.UnitPrice),
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
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

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
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

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

    private static IOrderedQueryable<Payment>? ApplyPaymentSorting(
        IQueryable<Payment> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim();

        IOrderedQueryable<Payment>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "createdat" => descending ? query.OrderByDescending(payment => payment.CreatedAt) : query.OrderBy(payment => payment.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(payment => payment.UpdatedAt) : query.OrderBy(payment => payment.UpdatedAt),
            "ordernumber" => descending ? query.OrderByDescending(payment => payment.Order!.OrderNumber) : query.OrderBy(payment => payment.Order!.OrderNumber),
            "restaurantname" => descending ? query.OrderByDescending(payment => payment.Order!.Restaurant!.Name) : query.OrderBy(payment => payment.Order!.Restaurant!.Name),
            "status" => descending ? query.OrderByDescending(payment => payment.Status) : query.OrderBy(payment => payment.Status),
            "amount" => descending ? query.OrderByDescending(payment => payment.AmountCents) : query.OrderBy(payment => payment.AmountCents),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(payment => payment.Id)
                : sorted.ThenBy(payment => payment.Id);
    }

    private static AdminPaymentResponse MapToAdminPaymentResponse(Payment payment)
    {
        return new AdminPaymentResponse
        {
            Id = payment.Id,
            OrderId = payment.OrderId,
            OrderNumber = payment.Order?.OrderNumber ?? string.Empty,
            RestaurantId = payment.Order?.RestaurantId,
            RestaurantName = payment.Order?.Restaurant?.Name,
            CustomerName = payment.Order?.Customer?.FullName,
            CustomerEmail = payment.Order?.Customer?.Email,
            OrderStatus = payment.Order?.Status.ToString() ?? string.Empty,
            OrderType = payment.Order?.OrderType.ToString() ?? string.Empty,
            Provider = payment.Provider,
            Status = payment.Status.ToString(),
            AmountCents = payment.AmountCents,
            Currency = payment.Currency,
            ProviderCheckoutSessionId = payment.ProviderCheckoutSessionId,
            ProviderPaymentIntentId = payment.ProviderPaymentIntentId,
            FailureReason = payment.FailureReason,
            CreatedAt = payment.CreatedAt,
            UpdatedAt = payment.UpdatedAt,
            PaidAt = payment.PaidAt,
            FailedAt = payment.FailedAt
        };
    }

    private static bool TryParseFilter<TEnum>(
        string? value,
        string parameterName,
        out TEnum? parsed,
        out string? error)
        where TEnum : struct, Enum
    {
        parsed = null;
        error = null;

        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (Enum.TryParse<TEnum>(value, true, out var result) && Enum.IsDefined(result))
        {
            parsed = result;
            return true;
        }

        error = $"Unsupported {parameterName} value. Allowed values: {string.Join(", ", Enum.GetNames<TEnum>())}.";
        return false;
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

    private static string AddReturnToUrl(string url, string? returnTo)
    {
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(returnTo))
        {
            return url;
        }

        return QueryHelpers.AddQueryString(url, "returnTo", returnTo);
    }

    private static string? NormalizeMenuReturnPath(string? returnTo)
    {
        if (string.IsNullOrWhiteSpace(returnTo))
        {
            return null;
        }

        var candidate = returnTo.Trim();
        if (!candidate.StartsWith("/", StringComparison.Ordinal) ||
            candidate.StartsWith("//", StringComparison.Ordinal) ||
            candidate.Contains("://", StringComparison.Ordinal))
        {
            return null;
        }

        var queryIndex = candidate.IndexOfAny(['?', '#']);
        var path = queryIndex >= 0 ? candidate[..queryIndex] : candidate;

        if (path.StartsWith("/table/", StringComparison.OrdinalIgnoreCase) ||
            (path.StartsWith("/r/", StringComparison.OrdinalIgnoreCase) &&
                path.EndsWith("/menu", StringComparison.OrdinalIgnoreCase)))
        {
            return candidate;
        }

        return null;
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
        if (payment.Order is not null)
        {
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(payment.Order, cancellationToken);
        }

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
        if (payment.Order is not null)
        {
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(payment.Order, cancellationToken);
        }

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

    private async Task<bool> CanStartCheckoutSessionForOrderAsync(Order order)
    {
        if (await CanAccessRestaurantAsync(order.RestaurantId))
        {
            return true;
        }

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!string.IsNullOrWhiteSpace(order.CustomerId))
        {
            return string.Equals(order.CustomerId, currentUserId, StringComparison.Ordinal);
        }

        return true;
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
