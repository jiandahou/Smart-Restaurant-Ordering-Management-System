using System.Security.Claims;
using System.Text.Json;
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
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
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
    private const string RefundIdMetadataKey = "refundId";

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly OrderAutoAcceptanceService _orderAutoAcceptanceService;
    private readonly OrderRefundProcessor _orderRefundProcessor;
    private readonly StripeOrderCheckoutService _stripeOrderCheckoutService;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        OrderAutoAcceptanceService orderAutoAcceptanceService,
        OrderRefundProcessor orderRefundProcessor,
        StripeOrderCheckoutService stripeOrderCheckoutService,
        ReportLogWriter reportLogWriter,
        ILogger<PaymentsController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _orderAutoAcceptanceService = orderAutoAcceptanceService;
        _orderRefundProcessor = orderRefundProcessor;
        _stripeOrderCheckoutService = stripeOrderCheckoutService;
        _reportLogWriter = reportLogWriter;
        _logger = logger;
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("environment")]
    public ActionResult<object> GetPaymentEnvironment()
    {
        var mode = _stripeOptions.SecretKey.StartsWith("sk_live_", StringComparison.Ordinal)
            ? "Live"
            : _stripeOptions.SecretKey.StartsWith("sk_test_", StringComparison.Ordinal)
                ? "Test"
                : "Unconfigured";

        return Ok(new
        {
            provider = PaymentProviders.Stripe,
            mode,
            destructiveActionsRequireConfirmation = true
        });
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
            .Include(payment => payment.Refunds)
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

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("refunds")]
    public async Task<ActionResult<PagedResponse<AdminRefundResponse>>> GetRefunds(
        [FromQuery] AdminRefundListRequest request,
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

        var query = BuildRefundQuery(currentRestaurantId, request.RestaurantId);

        if (!TryParseFilter<PaymentRefundStatus>(request.Status, nameof(request.Status), out var refundStatus, out var filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (refundStatus.HasValue)
        {
            query = query.Where(refund => refund.Status == refundStatus.Value);
        }

        if (request.CreatedFromUtc.HasValue)
        {
            query = query.Where(refund => refund.CreatedAt >= request.CreatedFromUtc.Value);
        }

        if (request.CreatedToUtc.HasValue)
        {
            query = query.Where(refund => refund.CreatedAt < request.CreatedToUtc.Value);
        }

        query = ApplyRefundSearch(query, request.Search);

        var sortedQuery = ApplyRefundSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "updatedAt", "orderNumber", "restaurantName", "status", "amount" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(new PagedResponse<AdminRefundResponse>
        {
            Items = page.Items.Select(MapToAdminRefundResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("refunds/summary")]
    public async Task<ActionResult<AdminRefundSummaryResponse>> GetRefundSummary(
        [FromQuery] AdminRefundSummaryRequest request,
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

        var query = BuildRefundQuery(currentRestaurantId, request.RestaurantId);

        if (!TryParseFilter<PaymentRefundStatus>(request.Status, nameof(request.Status), out var refundStatus, out var filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (refundStatus.HasValue)
        {
            query = query.Where(refund => refund.Status == refundStatus.Value);
        }

        if (request.CreatedFromUtc.HasValue)
        {
            query = query.Where(refund => refund.CreatedAt >= request.CreatedFromUtc.Value);
        }

        if (request.CreatedToUtc.HasValue)
        {
            query = query.Where(refund => refund.CreatedAt < request.CreatedToUtc.Value);
        }

        query = ApplyRefundSearch(query, request.Search);

        var summary = await query
            .GroupBy(_ => 1)
            .Select(group => new AdminRefundSummaryResponse
            {
                Total = group.Count(),
                Pending = group.Count(refund => refund.Status == PaymentRefundStatus.Pending),
                Succeeded = group.Count(refund => refund.Status == PaymentRefundStatus.Succeeded),
                Failed = group.Count(refund => refund.Status == PaymentRefundStatus.Failed)
            })
            .SingleOrDefaultAsync(cancellationToken) ?? new AdminRefundSummaryResponse();

        summary.AmountsByCurrency = await query
            .GroupBy(refund => refund.Currency)
            .Select(group => new AdminRefundCurrencySummaryResponse
            {
                Currency = group.Key,
                PendingAmountCents = group
                    .Where(refund => refund.Status == PaymentRefundStatus.Pending)
                    .Sum(refund => refund.AmountCents),
                SucceededAmountCents = group
                    .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                    .Sum(refund => refund.AmountCents),
                FailedAmountCents = group
                    .Where(refund => refund.Status == PaymentRefundStatus.Failed)
                    .Sum(refund => refund.AmountCents)
            })
            .OrderBy(item => item.Currency)
            .ToListAsync(cancellationToken);

        return Ok(summary);
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("refund-requests")]
    public async Task<ActionResult<PagedResponse<AdminRefundRequestResponse>>> GetRefundRequests(
        [FromQuery] AdminRefundRequestListRequest request,
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

        var query = BuildRefundRequestQuery(currentRestaurantId, request.RestaurantId);

        if (!TryParseFilter<PaymentRefundRequestStatus>(request.Status, nameof(request.Status), out var requestStatus, out var filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (requestStatus.HasValue)
        {
            query = query.Where(item => item.Status == requestStatus.Value);
        }

        if (request.CreatedFromUtc.HasValue)
        {
            query = query.Where(item => item.CreatedAt >= request.CreatedFromUtc.Value);
        }

        if (request.CreatedToUtc.HasValue)
        {
            query = query.Where(item => item.CreatedAt < request.CreatedToUtc.Value);
        }

        query = ApplyRefundRequestSearch(query, request.Search);

        var sortedQuery = ApplyRefundRequestSorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "updatedAt", "reviewedAt", "orderNumber", "restaurantName", "status", "amount" }
            });
        }

        var page = await sortedQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(new PagedResponse<AdminRefundRequestResponse>
        {
            Items = page.Items.Select(MapToAdminRefundRequestResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("refund-requests/{requestId:guid}/approve")]
    public async Task<ActionResult<AdminRefundRequestResponse>> ApproveRefundRequest(
        Guid requestId,
        ReviewRefundRequestRequest? request,
        CancellationToken cancellationToken)
    {
        var note = TrimOrNull(request?.Note);
        if (note?.Length > 1_000)
        {
            return BadRequest(new { message = "Note cannot exceed 1000 characters." });
        }

        var refundRequest = await LoadRefundRequestForReviewAsync(requestId, cancellationToken);
        if (refundRequest is null)
        {
            return NotFound(new { message = "Refund request not found." });
        }

        if (!await CanAccessRefundRequestAsync(refundRequest))
        {
            return Forbid();
        }

        if (refundRequest.Status != PaymentRefundRequestStatus.Pending)
        {
            return Conflict(new
            {
                message = "Only pending refund requests can be approved.",
                status = refundRequest.Status.ToString()
            });
        }

        if (refundRequest.Order is null)
        {
            return Conflict(new { message = "Refund request is missing its order." });
        }

        var claimedAt = DateTime.UtcNow;
        var claimedRows = await _dbContext.PaymentRefundRequests
            .Where(item =>
                item.Id == requestId &&
                item.Status == PaymentRefundRequestStatus.Pending)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(item => item.Status, PaymentRefundRequestStatus.Processing)
                    .SetProperty(item => item.UpdatedAt, claimedAt),
                cancellationToken);
        if (claimedRows != 1)
        {
            return Conflict(new
            {
                message = "This refund request is already being reviewed.",
                status = PaymentRefundRequestStatus.Processing.ToString()
            });
        }

        refundRequest.Status = PaymentRefundRequestStatus.Processing;
        refundRequest.UpdatedAt = claimedAt;

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var refundReason = BuildApprovalRefundReason(refundRequest.Reason, note);
        OrderRefundProcessResult result;
        try
        {
            result = await _orderRefundProcessor.RefundAsync(
                refundRequest.Order,
                userId,
                refundReason,
                "refund-request-approval",
                cancellationToken,
                $"refund-request-{refundRequest.Id:N}",
                refundRequest.RequestedAmountCents);
        }
        catch
        {
            await ResetRefundRequestClaimAsync(requestId, cancellationToken);
            throw;
        }

        if (!result.IsSuccess)
        {
            await ResetRefundRequestClaimAsync(requestId, cancellationToken);

            return StatusCode(result.StatusCode, new
            {
                message = result.Message,
                detail = result.Detail
            });
        }

        var now = DateTime.UtcNow;
        refundRequest.Status = PaymentRefundRequestStatus.Approved;
        refundRequest.PaymentRefundId = result.Refund?.Id;
        refundRequest.AdminNote = note;
        refundRequest.ReviewedByUserId = userId;
        refundRequest.ReviewedAt = now;
        refundRequest.UpdatedAt = now;
        _reportLogWriter.AddAudit(
            "RefundRequest.Approved",
            "PaymentRefundRequest",
            refundRequest.Id.ToString(),
            refundRequest.RestaurantId,
            $"Refund request approved for {refundRequest.Order?.OrderNumber ?? refundRequest.OrderId.ToString()}.",
            after: new
            {
                refundRequestId = refundRequest.Id,
                refundRequest.OrderId,
                refundRequest.PaymentId,
                refundRequest.PaymentRefundId,
                refundRequest.Status,
                note
            });
        if (refundRequest.Order is not null)
        {
            _reportLogWriter.AddOrderEvent(
                refundRequest.Order,
                "refund_request.approved",
                $"Refund request approved for {refundRequest.Order.OrderNumber}.",
                new
                {
                    refundRequestId = refundRequest.Id,
                    refundRequest.PaymentId,
                    refundRequest.PaymentRefundId,
                    note
                });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(MapToAdminRefundRequestResponse(refundRequest));
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("refund-requests/{requestId:guid}/reject")]
    public async Task<ActionResult<AdminRefundRequestResponse>> RejectRefundRequest(
        Guid requestId,
        ReviewRefundRequestRequest? request,
        CancellationToken cancellationToken)
    {
        var note = TrimOrNull(request?.Note);
        if (string.IsNullOrWhiteSpace(note))
        {
            return BadRequest(new { message = "A rejection note is required." });
        }

        if (note.Length > 1_000)
        {
            return BadRequest(new { message = "Note cannot exceed 1000 characters." });
        }

        var refundRequest = await LoadRefundRequestForReviewAsync(requestId, cancellationToken);
        if (refundRequest is null)
        {
            return NotFound(new { message = "Refund request not found." });
        }

        if (!await CanAccessRefundRequestAsync(refundRequest))
        {
            return Forbid();
        }

        if (refundRequest.Status != PaymentRefundRequestStatus.Pending)
        {
            return Conflict(new
            {
                message = "Only pending refund requests can be rejected.",
                status = refundRequest.Status.ToString()
            });
        }

        var now = DateTime.UtcNow;
        refundRequest.Status = PaymentRefundRequestStatus.Rejected;
        refundRequest.AdminNote = note;
        refundRequest.ReviewedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        refundRequest.ReviewedAt = now;
        refundRequest.UpdatedAt = now;
        _reportLogWriter.AddAudit(
            "RefundRequest.Rejected",
            "PaymentRefundRequest",
            refundRequest.Id.ToString(),
            refundRequest.RestaurantId,
            $"Refund request rejected for {refundRequest.Order?.OrderNumber ?? refundRequest.OrderId.ToString()}.",
            after: new
            {
                refundRequestId = refundRequest.Id,
                refundRequest.OrderId,
                refundRequest.PaymentId,
                refundRequest.Status,
                note
            });
        if (refundRequest.Order is not null)
        {
            _reportLogWriter.AddOrderEvent(
                refundRequest.Order,
                "refund_request.rejected",
                $"Refund request rejected for {refundRequest.Order.OrderNumber}.",
                new
                {
                    refundRequestId = refundRequest.Id,
                    refundRequest.PaymentId,
                    note
                });
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(MapToAdminRefundRequestResponse(refundRequest));
    }

    [AllowAnonymous]
    [HttpPost("checkout-session/order")]
    public async Task<ActionResult<CreateCheckoutSessionResponse>> StartOrderCheckoutSession(
        CreateOrderCheckoutSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (request.OrderId == Guid.Empty)
        {
            return BadRequest(new { message = "OrderId is required." });
        }

        var order = await _dbContext.Orders
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == request.OrderId, cancellationToken);

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

        var result = await _stripeOrderCheckoutService.StartAsync(
            order.Id,
            User.FindFirstValue(ClaimTypes.Email),
            NormalizeMenuReturnPath(request.ReturnTo),
            cancellationToken);

        if (!result.IsSuccess)
        {
            return StatusCode(result.StatusCode, new
            {
                message = result.Message,
                detail = result.Detail
            });
        }

        return Ok(result.Response);
    }

    [NonAction]
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
            _reportLogWriter.AddAudit(
                "Payment.CheckoutSessionCreated",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"Stripe checkout session created for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    sessionId = session.Id,
                    paymentIntentId = session.PaymentIntentId,
                    payment.AmountCents,
                    payment.Currency
                });
            _reportLogWriter.AddPaymentEvent(
                order,
                payment,
                null,
                "checkout_session.created",
                session.Id,
                payment.Status.ToString(),
                "Stripe checkout session created.",
                new
                {
                    sessionId = session.Id,
                    paymentIntentId = session.PaymentIntentId,
                    payment.AmountCents,
                    payment.Currency
                });
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
            _reportLogWriter.AddAudit(
                "Payment.CheckoutSessionFailed",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"Stripe checkout session failed for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    payment.AmountCents,
                    payment.Currency,
                    payment.FailureReason
                });
            _reportLogWriter.AddPaymentEvent(
                order,
                payment,
                null,
                "checkout_session.failed",
                null,
                payment.Status.ToString(),
                "Stripe checkout session failed.",
                new
                {
                    payment.AmountCents,
                    payment.Currency,
                    payment.FailureReason
                });
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
        var webhookSecrets = new[]
            {
                _stripeOptions.WebhookSecret,
                _stripeOptions.ConnectWebhookSecret
            }
            .Where(secret => !string.IsNullOrWhiteSpace(secret))
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        if (webhookSecrets.Length == 0)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe webhook secrets are not configured."
            });
        }

        var payload = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync(cancellationToken);
        var signatureHeader = Request.Headers["Stripe-Signature"].ToString();
        Event? stripeEvent = null;

        foreach (var webhookSecret in webhookSecrets)
        {
            try
            {
                stripeEvent = EventUtility.ConstructEvent(
                    payload,
                    signatureHeader,
                    webhookSecret);
                break;
            }
            catch (StripeException)
            {
                // Platform and connected-account event destinations use different secrets.
            }
        }

        if (stripeEvent is null)
        {
            _logger.LogWarning("Rejected Stripe webhook with invalid signature.");
            return BadRequest(new
            {
                message = "Invalid Stripe webhook signature."
            });
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        if (await _dbContext.StripeWebhookEvents
            .AnyAsync(item => item.EventId == stripeEvent.Id, cancellationToken))
        {
            await transaction.RollbackAsync(cancellationToken);
            return Ok(new { received = true, duplicate = true });
        }

        _dbContext.StripeWebhookEvents.Add(new StripeWebhookEvent
        {
            EventId = stripeEvent.Id,
            StripeAccountId = stripeEvent.Account,
            EventType = stripeEvent.Type,
            ProviderCreatedAt = stripeEvent.Created.ToUniversalTime(),
            ProcessedAt = DateTime.UtcNow
        });

        try
        {
            switch (stripeEvent.Type)
            {
                case "account.updated":
                    await UpdateRestaurantFromStripeAccountAsync(stripeEvent, cancellationToken);
                    break;
                case "checkout.session.completed":
                    if (!await UpdatePlatformFeeFromCheckoutSessionAsync(stripeEvent, true, cancellationToken))
                    {
                        var checkoutStatus = stripeEvent.Data.Object is Session completedSession &&
                            string.Equals(completedSession.PaymentStatus, "paid", StringComparison.OrdinalIgnoreCase)
                                ? PaymentStatus.Paid
                                : PaymentStatus.Pending;
                        await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, checkoutStatus, cancellationToken);
                    }
                    break;
                case "checkout.session.async_payment_succeeded":
                    if (!await UpdatePlatformFeeFromCheckoutSessionAsync(stripeEvent, true, cancellationToken))
                    {
                        await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, PaymentStatus.Paid, cancellationToken);
                    }
                    break;
                case "checkout.session.async_payment_failed":
                    if (!await UpdatePlatformFeeFromCheckoutSessionAsync(stripeEvent, false, cancellationToken))
                    {
                        await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, PaymentStatus.Failed, cancellationToken);
                    }
                    break;
                case "checkout.session.expired":
                    if (!await UpdatePlatformFeeFromCheckoutSessionAsync(stripeEvent, false, cancellationToken))
                    {
                        await UpdatePaymentFromCheckoutSessionAsync(stripeEvent, PaymentStatus.Expired, cancellationToken);
                    }
                    break;
                case "payment_intent.succeeded":
                    await UpdatePaymentFromPaymentIntentAsync(stripeEvent, PaymentStatus.Paid, cancellationToken);
                    break;
                case "payment_intent.payment_failed":
                    await UpdatePaymentFromPaymentIntentAsync(stripeEvent, PaymentStatus.Failed, cancellationToken);
                    break;
                case "payment_intent.canceled":
                    await UpdatePaymentFromPaymentIntentAsync(stripeEvent, PaymentStatus.Cancelled, cancellationToken);
                    break;
                case "refund.created":
                case "refund.updated":
                case "refund.failed":
                    await UpsertRefundFromStripeEventAsync(stripeEvent, cancellationToken);
                    break;
                case "charge.refunded":
                    await ReconcileChargeRefundedAsync(stripeEvent, cancellationToken);
                    break;
                case "charge.dispute.created":
                case "charge.dispute.updated":
                case "charge.dispute.closed":
                    await RecordDisputeEventAsync(stripeEvent, cancellationToken);
                    break;
                default:
                    _logger.LogInformation("Ignored Stripe webhook event {EventType}.", stripeEvent.Type);
                    break;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsDuplicateWebhookEvent(ex))
        {
            await transaction.RollbackAsync(cancellationToken);
            return Ok(new { received = true, duplicate = true });
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

    private IQueryable<PaymentRefund> BuildRefundQuery(Guid? currentRestaurantId, Guid? requestedRestaurantId)
    {
        var query = _dbContext.PaymentRefunds
            .AsNoTracking()
            .Include(refund => refund.Payment)
                .ThenInclude(payment => payment!.Order)
                    .ThenInclude(order => order!.Restaurant)
            .Include(refund => refund.Payment)
                .ThenInclude(payment => payment!.Order)
                    .ThenInclude(order => order!.Customer)
            .AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(refund =>
                refund.Payment != null &&
                refund.Payment.Order != null &&
                refund.Payment.Order.RestaurantId == currentRestaurantId);
        }

        if (requestedRestaurantId.HasValue)
        {
            query = query.Where(refund =>
                refund.Payment != null &&
                refund.Payment.Order != null &&
                refund.Payment.Order.RestaurantId == requestedRestaurantId);
        }

        return query;
    }

    private IQueryable<PaymentRefundRequest> BuildRefundRequestQuery(Guid? currentRestaurantId, Guid? requestedRestaurantId)
    {
        var query = _dbContext.PaymentRefundRequests
            .AsNoTracking()
            .Include(request => request.Order)
                .ThenInclude(order => order!.Restaurant)
            .Include(request => request.Order)
                .ThenInclude(order => order!.Customer)
            .Include(request => request.Payment)
                .ThenInclude(payment => payment!.Refunds)
            .Include(request => request.PaymentRefund)
            .AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(request => request.RestaurantId == currentRestaurantId);
        }

        if (requestedRestaurantId.HasValue)
        {
            query = query.Where(request => request.RestaurantId == requestedRestaurantId);
        }

        return query;
    }

    private static IQueryable<PaymentRefundRequest> ApplyRefundRequestSearch(
        IQueryable<PaymentRefundRequest> query,
        string? search)
    {
        search = search?.Trim();
        if (string.IsNullOrWhiteSpace(search))
        {
            return query;
        }

        var pattern = $"%{search}%";
        return query.Where(request =>
            (request.Reason != null && EF.Functions.ILike(request.Reason, pattern)) ||
            (request.AdminNote != null && EF.Functions.ILike(request.AdminNote, pattern)) ||
            (request.RequesterName != null && EF.Functions.ILike(request.RequesterName, pattern)) ||
            (request.RequesterEmail != null && EF.Functions.ILike(request.RequesterEmail, pattern)) ||
            (request.Order != null && EF.Functions.ILike(request.Order.OrderNumber, pattern)) ||
            (request.Order != null && request.Order.Restaurant != null && EF.Functions.ILike(request.Order.Restaurant.Name, pattern)) ||
            (request.Order != null && request.Order.Customer != null && request.Order.Customer.Email != null && EF.Functions.ILike(request.Order.Customer.Email, pattern)));
    }

    private static IOrderedQueryable<PaymentRefundRequest>? ApplyRefundRequestSorting(
        IQueryable<PaymentRefundRequest> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim();

        IOrderedQueryable<PaymentRefundRequest>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "createdat" => descending ? query.OrderByDescending(request => request.CreatedAt) : query.OrderBy(request => request.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(request => request.UpdatedAt) : query.OrderBy(request => request.UpdatedAt),
            "reviewedat" => descending ? query.OrderByDescending(request => request.ReviewedAt) : query.OrderBy(request => request.ReviewedAt),
            "ordernumber" => descending ? query.OrderByDescending(request => request.Order!.OrderNumber) : query.OrderBy(request => request.Order!.OrderNumber),
            "restaurantname" => descending ? query.OrderByDescending(request => request.Order!.Restaurant!.Name) : query.OrderBy(request => request.Order!.Restaurant!.Name),
            "status" => descending ? query.OrderByDescending(request => request.Status) : query.OrderBy(request => request.Status),
            "amount" => descending ? query.OrderByDescending(request => request.RequestedAmountCents) : query.OrderBy(request => request.RequestedAmountCents),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(request => request.Id)
                : sorted.ThenBy(request => request.Id);
    }

    private static IQueryable<PaymentRefund> ApplyRefundSearch(
        IQueryable<PaymentRefund> query,
        string? search)
    {
        search = search?.Trim();
        if (string.IsNullOrWhiteSpace(search))
        {
            return query;
        }

        var pattern = $"%{search}%";
        return query.Where(refund =>
            (refund.ProviderRefundId != null && EF.Functions.ILike(refund.ProviderRefundId, pattern)) ||
            (refund.ProviderPaymentIntentId != null && EF.Functions.ILike(refund.ProviderPaymentIntentId, pattern)) ||
            (refund.Reason != null && EF.Functions.ILike(refund.Reason, pattern)) ||
            (refund.FailureReason != null && EF.Functions.ILike(refund.FailureReason, pattern)) ||
            (refund.Payment != null && refund.Payment.Order != null && EF.Functions.ILike(refund.Payment.Order.OrderNumber, pattern)) ||
            (refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.Restaurant != null && EF.Functions.ILike(refund.Payment.Order.Restaurant.Name, pattern)) ||
            (refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.Customer != null && refund.Payment.Order.Customer.Email != null && EF.Functions.ILike(refund.Payment.Order.Customer.Email, pattern)));
    }

    private static IOrderedQueryable<PaymentRefund>? ApplyRefundSorting(
        IQueryable<PaymentRefund> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim();

        IOrderedQueryable<PaymentRefund>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "createdat" => descending ? query.OrderByDescending(refund => refund.CreatedAt) : query.OrderBy(refund => refund.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(refund => refund.UpdatedAt) : query.OrderBy(refund => refund.UpdatedAt),
            "ordernumber" => descending ? query.OrderByDescending(refund => refund.Payment!.Order!.OrderNumber) : query.OrderBy(refund => refund.Payment!.Order!.OrderNumber),
            "restaurantname" => descending ? query.OrderByDescending(refund => refund.Payment!.Order!.Restaurant!.Name) : query.OrderBy(refund => refund.Payment!.Order!.Restaurant!.Name),
            "status" => descending ? query.OrderByDescending(refund => refund.Status) : query.OrderBy(refund => refund.Status),
            "amount" => descending ? query.OrderByDescending(refund => refund.AmountCents) : query.OrderBy(refund => refund.AmountCents),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(refund => refund.Id)
                : sorted.ThenBy(refund => refund.Id);
    }

    private static AdminRefundResponse MapToAdminRefundResponse(PaymentRefund refund) =>
        new()
        {
            Id = refund.Id,
            PaymentId = refund.PaymentId,
            OrderId = refund.OrderId,
            OrderNumber = refund.Payment?.Order?.OrderNumber ?? string.Empty,
            RestaurantId = refund.Payment?.Order?.RestaurantId,
            RestaurantName = refund.Payment?.Order?.Restaurant?.Name,
            CustomerName = refund.Payment?.Order?.Customer?.FullName,
            CustomerEmail = refund.Payment?.Order?.Customer?.Email,
            Provider = refund.Provider,
            ProviderRefundId = refund.ProviderRefundId,
            ProviderPaymentIntentId = refund.ProviderPaymentIntentId,
            AmountCents = refund.AmountCents,
            Currency = refund.Currency,
            Status = refund.Status.ToString(),
            Reason = refund.Reason,
            FailureReason = refund.FailureReason,
            RequestedByUserId = refund.RequestedByUserId,
            CreatedAt = refund.CreatedAt,
            UpdatedAt = refund.UpdatedAt,
            RefundedAt = refund.RefundedAt,
            FailedAt = refund.FailedAt
        };

    private static AdminRefundRequestResponse MapToAdminRefundRequestResponse(PaymentRefundRequest request)
    {
        var succeededRefundAmount = request.Payment?.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents) ?? 0;
        var originalPaymentAmount = request.Payment?.AmountCents ?? request.RequestedAmountCents;

        return new()
        {
            Id = request.Id,
            OrderId = request.OrderId,
            PaymentId = request.PaymentId,
            PaymentRefundId = request.PaymentRefundId,
            RestaurantId = request.RestaurantId,
            RestaurantName = request.Order?.Restaurant?.Name,
            OrderNumber = request.Order?.OrderNumber ?? string.Empty,
            CustomerName = request.RequesterName ?? request.Order?.Customer?.FullName,
            CustomerEmail = request.RequesterEmail ?? request.Order?.Customer?.Email,
            Status = request.Status.ToString(),
            RequestedAmountCents = request.RequestedAmountCents,
            OriginalPaymentAmountCents = originalPaymentAmount,
            AlreadyRefundedAmountCents = succeededRefundAmount,
            RefundableAmountCents = Math.Max(0, originalPaymentAmount - succeededRefundAmount),
            PreviousRefundCount = request.Payment?.Refunds.Count ?? 0,
            ProviderPaymentIntentId = request.Payment?.ProviderPaymentIntentId,
            Currency = request.Currency,
            Reason = request.Reason,
            AdminNote = request.AdminNote,
            RequestedByUserId = request.RequestedByUserId,
            ReviewedByUserId = request.ReviewedByUserId,
            CreatedAt = request.CreatedAt,
            UpdatedAt = request.UpdatedAt,
            ReviewedAt = request.ReviewedAt
        };
    }

    private async Task UpdateRestaurantFromStripeAccountAsync(
        Event stripeEvent,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Account account)
        {
            _logger.LogWarning("Stripe account.updated event did not contain an account.");
            return;
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(
                item => item.StripeAccountId == account.Id,
                cancellationToken);

        if (restaurant is null)
        {
            _logger.LogWarning("No restaurant found for Stripe account {StripeAccountId}.", account.Id);
            return;
        }

        StripeConnectAccountState.Apply(restaurant, account);
        var snapshot = StripeConnectAccountState.Read(restaurant.StripeRequirementsDueJson);
        var requirements = StripeConnectAccountState.GetActionableRequirements(snapshot);
        restaurant.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "Restaurant.StripeAccountUpdated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Stripe account status updated for {restaurant.Name}.",
            after: new
            {
                account.Id,
                account.DetailsSubmitted,
                account.ChargesEnabled,
                account.PayoutsEnabled,
                requirements,
                snapshot.PendingVerification,
                snapshot.DisabledReason,
                snapshot.Errors
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
    }

    private async Task<bool> UpdatePlatformFeeFromCheckoutSessionAsync(
        Event stripeEvent,
        bool completed,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Session session ||
            !session.Metadata.TryGetValue("mode", out var mode) ||
            !string.Equals(mode, "restaurant_platform_setup_fee", StringComparison.Ordinal) ||
            !session.Metadata.TryGetValue("restaurantId", out var restaurantId) ||
            !Guid.TryParse(restaurantId, out var parsedRestaurantId))
        {
            return false;
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == parsedRestaurantId, cancellationToken);

        if (restaurant is null)
        {
            _logger.LogWarning(
                "No restaurant found for platform fee Stripe session {SessionId}.",
                session.Id);
            return true;
        }

        if (!string.Equals(
            restaurant.OneTimePlatformFeeCheckoutSessionId,
            session.Id,
            StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "Ignored stale platform fee session {SessionId} for restaurant {RestaurantId}.",
                session.Id,
                restaurant.Id);
            return true;
        }

        var wasPaid = completed &&
            string.Equals(session.PaymentStatus, "paid", StringComparison.OrdinalIgnoreCase);

        if (wasPaid)
        {
            restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Paid;
            restaurant.OneTimePlatformFeePaidAt ??= DateTime.UtcNow;
            restaurant.OneTimePlatformFeePaymentIntentId = session.PaymentIntentId;
        }
        else if (!completed && !restaurant.OneTimePlatformFeePaidAt.HasValue)
        {
            restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Failed;
            restaurant.OneTimePlatformFeeCheckoutUrl = null;
            restaurant.OneTimePlatformFeeIdempotencyKey = null;
        }

        restaurant.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            wasPaid
                ? "Restaurant.PlatformFeePaid"
                : completed
                    ? "Restaurant.PlatformFeeCheckoutAwaitingPayment"
                    : "Restaurant.PlatformFeeCheckoutFailed",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            wasPaid
                ? $"One-time platform fee paid by {restaurant.Name}."
                : completed
                    ? $"One-time platform fee checkout completed for {restaurant.Name} and is awaiting payment confirmation."
                    : $"One-time platform fee checkout failed or expired for {restaurant.Name}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                sessionId = session.Id,
                session.PaymentStatus,
                restaurant.OneTimePlatformFeeCents,
                restaurant.OneTimePlatformFeeStatus
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        return true;
    }

    private static bool IsDuplicateWebhookEvent(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_StripeWebhookEvents_EventId"
        };

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
            RefundCount = payment.Refunds.Count,
            RefundedAmountCents = GetSucceededRefundedAmount(payment),
            RefundableAmountCents = Math.Max(0, payment.AmountCents - GetSucceededRefundedAmount(payment)),
            HasPendingRefund = payment.Refunds.Any(refund => refund.Status == PaymentRefundStatus.Pending),
            Refunds = payment.Refunds
                .OrderByDescending(refund => refund.CreatedAt)
                .ThenByDescending(refund => refund.Id)
                .Select(MapToAdminPaymentRefundResponse)
                .ToList(),
            CreatedAt = payment.CreatedAt,
            UpdatedAt = payment.UpdatedAt,
            PaidAt = payment.PaidAt,
            FailedAt = payment.FailedAt
        };
    }

    private static AdminPaymentRefundResponse MapToAdminPaymentRefundResponse(PaymentRefund refund) =>
        new()
        {
            Id = refund.Id,
            Provider = refund.Provider,
            ProviderRefundId = refund.ProviderRefundId,
            ProviderPaymentIntentId = refund.ProviderPaymentIntentId,
            AmountCents = refund.AmountCents,
            Currency = refund.Currency,
            Status = refund.Status.ToString(),
            Reason = refund.Reason,
            FailureReason = refund.FailureReason,
            RequestedByUserId = refund.RequestedByUserId,
            CreatedAt = refund.CreatedAt,
            UpdatedAt = refund.UpdatedAt,
            RefundedAt = refund.RefundedAt,
            FailedAt = refund.FailedAt
        };

    private static long GetSucceededRefundedAmount(Payment payment) =>
        payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

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

    private bool IsStripeEventForPayment(Payment payment, Event stripeEvent)
    {
        if (string.Equals(payment.StripeAccountId, stripeEvent.Account, StringComparison.Ordinal))
        {
            return true;
        }

        _logger.LogWarning(
            "Ignored Stripe event {EventId} for payment {PaymentId} because account {EventAccountId} does not match {PaymentAccountId}.",
            stripeEvent.Id,
            payment.Id,
            stripeEvent.Account ?? "(platform)",
            payment.StripeAccountId ?? "(platform)");
        return false;
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

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        var providerCreatedAt = stripeEvent.Created.ToUniversalTime();
        if (payment.LastProviderEventCreatedAt.HasValue &&
            payment.LastProviderEventCreatedAt.Value > providerCreatedAt)
        {
            _logger.LogInformation(
                "Ignored out-of-order Stripe event {EventId} for payment {PaymentId}.",
                stripeEvent.Id,
                payment.Id);
            return;
        }

        if (!PaymentStatePolicy.CanApplyProviderStatus(payment.Status, status))
        {
            _logger.LogInformation(
                "Ignored Stripe event {EventId} transition for payment {PaymentId}: {CurrentStatus} -> {IncomingStatus}.",
                stripeEvent.Id,
                payment.Id,
                payment.Status,
                status);
            return;
        }

        payment.Status = status;
        payment.ProviderCheckoutSessionId = session.Id;
        payment.ProviderPaymentIntentId = session.PaymentIntentId;
        payment.LastProviderEventCreatedAt = providerCreatedAt;
        payment.UpdatedAt = DateTime.UtcNow;

        if (status == PaymentStatus.Paid)
        {
            payment.PaidAt ??= DateTime.UtcNow;
            payment.FailedAt = null;
            payment.FailureReason = null;
        }
        else if (status is PaymentStatus.Failed or PaymentStatus.Expired or PaymentStatus.Cancelled)
        {
            payment.FailedAt = DateTime.UtcNow;
            payment.FailureReason = status == PaymentStatus.Expired
                ? "Stripe Checkout session expired."
                : session.PaymentStatus == "unpaid"
                    ? "Stripe Checkout did not complete payment."
                    : payment.FailureReason;
        }

        if (payment.Order is not null &&
            PaymentStatePolicy.CanApplyOrderStatus(payment.Order.PaymentStatus, status))
        {
            payment.Order.PaymentStatus = status;
            payment.Order.UpdatedAt = DateTime.UtcNow;
            if (status == PaymentStatus.Paid)
            {
                await _orderAutoAcceptanceService.TryAcceptAsync(payment.Order, cancellationToken);
            }
        }

        _reportLogWriter.AddAudit(
            "Payment.WebhookUpdated",
            "Payment",
            payment.Id.ToString(),
            payment.Order?.RestaurantId,
            $"Stripe webhook {stripeEvent.Type} updated payment {payment.Id} to {status}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                stripeEvent.Type,
                paymentId = payment.Id,
                orderId = payment.OrderId,
                sessionId = session.Id,
                paymentIntentId = session.PaymentIntentId,
                status
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        _reportLogWriter.AddPaymentEvent(
            payment.Order,
            payment,
            null,
            stripeEvent.Type,
            stripeEvent.Id,
            status.ToString(),
            $"Stripe checkout webhook updated payment to {status}.",
            new
            {
                sessionId = session.Id,
                paymentIntentId = session.PaymentIntentId
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        if (payment.Order is not null)
        {
            _reportLogWriter.AddOrderEvent(
                payment.Order,
                "payment.status_updated",
                $"{payment.Order.OrderNumber} payment is {status}.",
                new
                {
                    paymentId = payment.Id,
                    stripeEventId = stripeEvent.Id,
                    stripeEvent.Type,
                    status
                },
                actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
                correlationId: stripeEvent.Id);
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

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        var providerCreatedAt = stripeEvent.Created.ToUniversalTime();
        if (payment.LastProviderEventCreatedAt.HasValue &&
            payment.LastProviderEventCreatedAt.Value > providerCreatedAt)
        {
            _logger.LogInformation(
                "Ignored out-of-order Stripe event {EventId} for payment {PaymentId}.",
                stripeEvent.Id,
                payment.Id);
            return;
        }

        if (!PaymentStatePolicy.CanApplyProviderStatus(payment.Status, status))
        {
            _logger.LogInformation(
                "Ignored Stripe event {EventId} transition for payment {PaymentId}: {CurrentStatus} -> {IncomingStatus}.",
                stripeEvent.Id,
                payment.Id,
                payment.Status,
                status);
            return;
        }

        payment.Status = status;
        payment.ProviderPaymentIntentId = paymentIntent.Id;
        payment.LastProviderEventCreatedAt = providerCreatedAt;
        payment.UpdatedAt = DateTime.UtcNow;

        if (status == PaymentStatus.Paid)
        {
            payment.PaidAt ??= DateTime.UtcNow;
            payment.FailedAt = null;
            payment.FailureReason = null;
        }
        else
        {
            payment.FailureReason = paymentIntent.LastPaymentError?.Message;
            payment.FailedAt = DateTime.UtcNow;
        }

        if (payment.Order is not null &&
            PaymentStatePolicy.CanApplyOrderStatus(payment.Order.PaymentStatus, status))
        {
            payment.Order.PaymentStatus = status;
            payment.Order.UpdatedAt = DateTime.UtcNow;
            if (status == PaymentStatus.Paid)
            {
                await _orderAutoAcceptanceService.TryAcceptAsync(payment.Order, cancellationToken);
            }
        }

        _reportLogWriter.AddAudit(
            "Payment.WebhookUpdated",
            "Payment",
            payment.Id.ToString(),
            payment.Order?.RestaurantId,
            $"Stripe webhook {stripeEvent.Type} updated payment {payment.Id} to {status}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                stripeEvent.Type,
                paymentId = payment.Id,
                orderId = payment.OrderId,
                paymentIntentId = paymentIntent.Id,
                status,
                failureReason = payment.FailureReason
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        _reportLogWriter.AddPaymentEvent(
            payment.Order,
            payment,
            null,
            stripeEvent.Type,
            stripeEvent.Id,
            status.ToString(),
            $"Stripe payment intent webhook updated payment to {status}.",
            new
            {
                paymentIntentId = paymentIntent.Id,
                failureReason = payment.FailureReason
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        if (payment.Order is not null)
        {
            _reportLogWriter.AddOrderEvent(
                payment.Order,
                "payment.status_updated",
                $"{payment.Order.OrderNumber} payment is {status}.",
                new
                {
                    paymentId = payment.Id,
                    stripeEventId = stripeEvent.Id,
                    stripeEvent.Type,
                    status,
                    failureReason = payment.FailureReason
                },
                actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
                correlationId: stripeEvent.Id);
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

    private async Task UpsertRefundFromStripeEventAsync(
        Event stripeEvent,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Refund stripeRefund)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a refund.", stripeEvent.Type);
            return;
        }

        var payment = await FindPaymentForRefundAsync(stripeRefund, cancellationToken);
        if (payment is null)
        {
            _logger.LogWarning(
                "No payment found for Stripe refund {RefundId} with payment intent {PaymentIntentId}.",
                stripeRefund.Id,
                stripeRefund.PaymentIntentId);
            return;
        }

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        var now = DateTime.UtcNow;
        var localRefund = await FindExistingRefundAsync(payment, stripeRefund, cancellationToken);

        if (localRefund is null)
        {
            localRefund = new PaymentRefund
            {
                Id = Guid.NewGuid(),
                PaymentId = payment.Id,
                Payment = payment,
                OrderId = payment.OrderId,
                Provider = PaymentProviders.Stripe,
                CreatedAt = stripeRefund.Created == default ? now : stripeRefund.Created
            };
            _dbContext.PaymentRefunds.Add(localRefund);
            payment.Refunds.Add(localRefund);
        }

        localRefund.ProviderRefundId = stripeRefund.Id;
        localRefund.ProviderPaymentIntentId = stripeRefund.PaymentIntentId ?? payment.ProviderPaymentIntentId;
        localRefund.AmountCents = stripeRefund.Amount;
        localRefund.Currency = NormalizeCurrency(stripeRefund.Currency ?? payment.Currency);
        localRefund.Status = MapStripeRefundStatus(stripeRefund.Status);
        localRefund.FailureReason = stripeRefund.FailureReason;
        localRefund.UpdatedAt = now;

        if (string.IsNullOrWhiteSpace(localRefund.Reason))
        {
            localRefund.Reason = ResolveRefundReason(stripeRefund);
        }

        if (localRefund.Status == PaymentRefundStatus.Succeeded)
        {
            localRefund.RefundedAt ??= now;
            localRefund.FailedAt = null;
        }
        else if (localRefund.Status == PaymentRefundStatus.Failed)
        {
            localRefund.FailedAt ??= now;
        }

        ReconcilePaymentRefundStatus(payment, now);
        _reportLogWriter.AddAudit(
            "PaymentRefund.WebhookUpdated",
            "PaymentRefund",
            localRefund.Id.ToString(),
            payment.Order?.RestaurantId,
            $"Stripe webhook {stripeEvent.Type} reconciled refund {localRefund.ProviderRefundId ?? localRefund.Id.ToString()} to {localRefund.Status}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                stripeEvent.Type,
                paymentId = payment.Id,
                orderId = payment.OrderId,
                refundId = localRefund.Id,
                stripeRefundId = localRefund.ProviderRefundId,
                localRefund.Status,
                localRefund.AmountCents,
                localRefund.Currency,
                localRefund.FailureReason
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        _reportLogWriter.AddPaymentEvent(
            payment.Order,
            payment,
            localRefund,
            stripeEvent.Type,
            stripeEvent.Id,
            localRefund.Status.ToString(),
            $"Stripe refund webhook reconciled refund to {localRefund.Status}.",
            new
            {
                stripeRefundId = localRefund.ProviderRefundId,
                localRefund.AmountCents,
                localRefund.Currency,
                localRefund.FailureReason
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        if (payment.Order is not null)
        {
            _reportLogWriter.AddOrderEvent(
                payment.Order,
                "payment.refund_reconciled",
                $"{payment.Order.OrderNumber} refund is {localRefund.Status}.",
                new
                {
                    paymentId = payment.Id,
                    refundId = localRefund.Id,
                    stripeRefundId = localRefund.ProviderRefundId,
                    stripeEventId = stripeEvent.Id,
                    stripeEvent.Type,
                    localRefund.Status,
                    localRefund.AmountCents,
                    localRefund.Currency,
                    localRefund.FailureReason
                },
                actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
                correlationId: stripeEvent.Id);
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (payment.Order is not null)
        {
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(payment.Order, cancellationToken);
        }

        _logger.LogInformation(
            "Reconciled Stripe refund {RefundId} for payment {PaymentId} from {EventType}.",
            stripeRefund.Id,
            payment.Id,
            stripeEvent.Type);
    }

    private async Task ReconcileChargeRefundedAsync(
        Event stripeEvent,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Charge charge)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a charge.", stripeEvent.Type);
            return;
        }

        if (string.IsNullOrWhiteSpace(charge.PaymentIntentId))
        {
            _logger.LogWarning("Refunded Stripe charge {ChargeId} did not include a payment intent.", charge.Id);
            return;
        }

        var payment = await _dbContext.Payments
            .Include(currentPayment => currentPayment.Refunds)
            .Include(currentPayment => currentPayment.Order)
            .FirstOrDefaultAsync(
                currentPayment => currentPayment.ProviderPaymentIntentId == charge.PaymentIntentId,
                cancellationToken);

        if (payment is null)
        {
            _logger.LogWarning(
                "No payment found for refunded Stripe charge {ChargeId} with payment intent {PaymentIntentId}.",
                charge.Id,
                charge.PaymentIntentId);
            return;
        }

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        ReconcilePaymentRefundStatus(payment, DateTime.UtcNow);
        _reportLogWriter.AddAudit(
            "PaymentRefund.ChargeReconciled",
            "Payment",
            payment.Id.ToString(),
            payment.Order?.RestaurantId,
            $"Stripe charge refund reconciled payment {payment.Id}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                chargeId = charge.Id,
                paymentIntentId = charge.PaymentIntentId,
                paymentId = payment.Id,
                orderId = payment.OrderId,
                payment.Status
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        _reportLogWriter.AddPaymentEvent(
            payment.Order,
            payment,
            null,
            stripeEvent.Type,
            stripeEvent.Id,
            payment.Status.ToString(),
            "Stripe charge.refunded reconciled payment refund status.",
            new
            {
                chargeId = charge.Id,
                paymentIntentId = charge.PaymentIntentId
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (payment.Order is not null)
        {
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(payment.Order, cancellationToken);
        }
    }

    private async Task RecordDisputeEventAsync(
        Event stripeEvent,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Dispute dispute ||
            string.IsNullOrWhiteSpace(dispute.PaymentIntentId))
        {
            _logger.LogWarning(
                "Stripe event {EventType} did not contain a dispute with a payment intent.",
                stripeEvent.Type);
            return;
        }

        var payment = await _dbContext.Payments
            .Include(item => item.Order)
            .FirstOrDefaultAsync(
                item => item.ProviderPaymentIntentId == dispute.PaymentIntentId,
                cancellationToken);

        if (payment is null)
        {
            _logger.LogWarning(
                "No payment found for Stripe dispute {DisputeId}.",
                dispute.Id);
            return;
        }

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        _reportLogWriter.AddAudit(
            "Payment.DisputeUpdated",
            "Payment",
            payment.Id.ToString(),
            payment.Order?.RestaurantId,
            $"Stripe dispute {dispute.Id} is {dispute.Status} for payment {payment.Id}.",
            after: new
            {
                stripeEventId = stripeEvent.Id,
                disputeId = dispute.Id,
                dispute.Status,
                dispute.Reason,
                dispute.Amount,
                dispute.Currency,
                paymentId = payment.Id,
                payment.OrderId
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
        _reportLogWriter.AddPaymentEvent(
            payment.Order,
            payment,
            null,
            stripeEvent.Type,
            dispute.Id,
            dispute.Status,
            $"Stripe dispute is {dispute.Status}.",
            new
            {
                stripeEventId = stripeEvent.Id,
                disputeId = dispute.Id,
                dispute.Reason,
                dispute.Amount,
                dispute.Currency
            },
            actorOverride: ReportActor.Provider(PaymentProviders.Stripe),
            correlationId: stripeEvent.Id);
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
                .Include(currentPayment => currentPayment.Refunds)
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(currentPayment => currentPayment.Id == parsedPaymentId, cancellationToken);

            if (paymentById is not null)
            {
                return paymentById;
            }
        }

        return await _dbContext.Payments
            .Include(currentPayment => currentPayment.Refunds)
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
                .Include(currentPayment => currentPayment.Refunds)
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(currentPayment => currentPayment.Id == parsedPaymentId, cancellationToken);

            if (paymentById is not null)
            {
                return paymentById;
            }
        }

        return await _dbContext.Payments
            .Include(currentPayment => currentPayment.Refunds)
            .Include(currentPayment => currentPayment.Order)
            .FirstOrDefaultAsync(
                currentPayment => currentPayment.ProviderPaymentIntentId == paymentIntentId,
                cancellationToken);
    }

    private async Task<Payment?> FindPaymentForRefundAsync(
        Refund stripeRefund,
        CancellationToken cancellationToken)
    {
        if (stripeRefund.Metadata.TryGetValue(PaymentIdMetadataKey, out var paymentId) &&
            Guid.TryParse(paymentId, out var parsedPaymentId))
        {
            var paymentById = await _dbContext.Payments
                .Include(currentPayment => currentPayment.Refunds)
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(currentPayment => currentPayment.Id == parsedPaymentId, cancellationToken);

            if (paymentById is not null)
            {
                return paymentById;
            }
        }

        if (!string.IsNullOrWhiteSpace(stripeRefund.PaymentIntentId))
        {
            return await _dbContext.Payments
                .Include(currentPayment => currentPayment.Refunds)
                .Include(currentPayment => currentPayment.Order)
                .FirstOrDefaultAsync(
                    currentPayment => currentPayment.ProviderPaymentIntentId == stripeRefund.PaymentIntentId,
                    cancellationToken);
        }

        return null;
    }

    private async Task<PaymentRefund?> FindExistingRefundAsync(
        Payment payment,
        Refund stripeRefund,
        CancellationToken cancellationToken)
    {
        if (stripeRefund.Metadata.TryGetValue(RefundIdMetadataKey, out var refundId) &&
            Guid.TryParse(refundId, out var parsedRefundId))
        {
            var refundById = payment.Refunds.FirstOrDefault(refund => refund.Id == parsedRefundId)
                ?? await _dbContext.PaymentRefunds
                    .FirstOrDefaultAsync(refund => refund.Id == parsedRefundId, cancellationToken);

            if (refundById is not null)
            {
                return refundById;
            }
        }

        return payment.Refunds.FirstOrDefault(refund => refund.ProviderRefundId == stripeRefund.Id)
            ?? await _dbContext.PaymentRefunds
                .FirstOrDefaultAsync(refund => refund.ProviderRefundId == stripeRefund.Id, cancellationToken);
    }

    private static string? ResolveRefundReason(Refund stripeRefund)
    {
        if (stripeRefund.Metadata.TryGetValue("reason", out var metadataReason) &&
            !string.IsNullOrWhiteSpace(metadataReason))
        {
            return metadataReason.Trim();
        }

        return string.IsNullOrWhiteSpace(stripeRefund.Reason) ? null : stripeRefund.Reason.Trim();
    }

    private static PaymentRefundStatus MapStripeRefundStatus(string? status) =>
        status?.Trim().ToLowerInvariant() switch
        {
            "succeeded" => PaymentRefundStatus.Succeeded,
            "failed" or "canceled" => PaymentRefundStatus.Failed,
            _ => PaymentRefundStatus.Pending
        };

    private static void ReconcilePaymentRefundStatus(Payment payment, DateTime now)
    {
        var refundedAmountCents = GetSucceededRefundedAmount(payment);
        var nextStatus = payment.Status;

        if (refundedAmountCents >= payment.AmountCents && payment.AmountCents > 0)
        {
            nextStatus = PaymentStatus.Refunded;
        }
        else if (refundedAmountCents > 0)
        {
            nextStatus = PaymentStatus.PartiallyRefunded;
        }
        else if (payment.Status is PaymentStatus.Refunded or PaymentStatus.PartiallyRefunded)
        {
            nextStatus = PaymentStatus.Paid;
        }

        if (payment.Status != nextStatus)
        {
            payment.Status = nextStatus;
            payment.UpdatedAt = now;
        }

        if (payment.Order is not null && payment.Order.PaymentStatus != nextStatus)
        {
            payment.Order.PaymentStatus = nextStatus;
            payment.Order.UpdatedAt = now;
        }
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

    private async Task<PaymentRefundRequest?> LoadRefundRequestForReviewAsync(
        Guid requestId,
        CancellationToken cancellationToken) =>
        await _dbContext.PaymentRefundRequests
            .Include(request => request.Order)
                .ThenInclude(order => order!.Payments)
                    .ThenInclude(payment => payment.Refunds)
            .Include(request => request.Order)
                .ThenInclude(order => order!.Restaurant)
            .Include(request => request.Order)
                .ThenInclude(order => order!.Customer)
            .Include(request => request.Payment)
            .Include(request => request.PaymentRefund)
            .FirstOrDefaultAsync(request => request.Id == requestId, cancellationToken);

    private async Task<bool> CanAccessRefundRequestAsync(PaymentRefundRequest request)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        return currentRestaurantId.HasValue && request.RestaurantId == currentRestaurantId.Value;
    }

    private Task ResetRefundRequestClaimAsync(Guid requestId, CancellationToken cancellationToken) =>
        _dbContext.PaymentRefundRequests
            .Where(item =>
                item.Id == requestId &&
                item.Status == PaymentRefundRequestStatus.Processing)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(item => item.Status, PaymentRefundRequestStatus.Pending)
                    .SetProperty(item => item.UpdatedAt, DateTime.UtcNow),
                cancellationToken);

    private static string? BuildApprovalRefundReason(string? customerReason, string? adminNote)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(customerReason))
        {
            parts.Add($"Customer: {customerReason.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(adminNote))
        {
            parts.Add($"Admin: {adminNote.Trim()}");
        }

        return parts.Count == 0 ? null : string.Join(" | ", parts);
    }

    private static string? TrimOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
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
