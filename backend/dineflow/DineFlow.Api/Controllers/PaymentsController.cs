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
using Microsoft.AspNetCore.RateLimiting;
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
    private readonly OrderPaymentLanding _orderPaymentLanding;
    private readonly OrderRefundProcessor _orderRefundProcessor;
    private readonly StripeOrderCheckoutService _stripeOrderCheckoutService;
    private readonly PaymentSyncService _paymentSyncService;
    private readonly PaymentNotificationService _paymentNotificationService;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        OrderPaymentLanding orderPaymentLanding,
        OrderRefundProcessor orderRefundProcessor,
        StripeOrderCheckoutService stripeOrderCheckoutService,
        PaymentSyncService paymentSyncService,
        PaymentNotificationService paymentNotificationService,
        ReportLogWriter reportLogWriter,
        ILogger<PaymentsController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _orderPaymentLanding = orderPaymentLanding;
        _orderRefundProcessor = orderRefundProcessor;
        _stripeOrderCheckoutService = stripeOrderCheckoutService;
        _paymentSyncService = paymentSyncService;
        _paymentNotificationService = paymentNotificationService;
        _reportLogWriter = reportLogWriter;
        _logger = logger;
    }

    /// <summary>
    /// Customer return-path recovery. The Checkout Session id is an unguessable Stripe identifier,
    /// and this endpoint can only perform an idempotent state refresh; it returns no order details.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.GuestOrderAccess)]
    [HttpPost("stripe/checkout-session/confirm")]
    public async Task<ActionResult<ConfirmCheckoutSessionResponse>> ConfirmCheckoutSession(
        ConfirmCheckoutSessionRequest request,
        CancellationToken cancellationToken)
    {
        var sessionId = request.SessionId.Trim();
        if (!sessionId.StartsWith("cs_", StringComparison.Ordinal))
        {
            return BadRequest(new { message = "Invalid Stripe Checkout Session id." });
        }

        var payment = await _dbContext.Payments
            .Include(item => item.Order)
                .ThenInclude(order => order!.Restaurant)
            .FirstOrDefaultAsync(
                item => item.Provider == PaymentProviders.Stripe &&
                    item.ProviderCheckoutSessionId == sessionId,
                cancellationToken);

        if (payment is null)
        {
            return NotFound(new { message = "Checkout session was not found." });
        }

        // Already settled and already synced once, so there is nothing left for Stripe to tell us:
        // the money has stopped moving, the settlement figures are on the row, and the only thing
        // that can still change is the order's own status, which is ours. The page polls this while
        // the customer waits — asking Stripe again each time would spend a round trip per open tab
        // to re-read an answer we hold.
        if (!NeedsProviderSync(payment))
        {
            return Ok(Describe(payment));
        }

        var result = await _paymentSyncService.SyncCheckoutSessionAsync(
            payment,
            actorUserId: null,
            cancellationToken);

        if (!result.IsSuccess)
        {
            return StatusCode(result.StatusCode, new { message = result.Message });
        }

        return Ok(Describe(payment));
    }

    /// <summary>
    /// Whether Stripe still has something to say about this payment.
    /// </summary>
    /// <remarks>
    /// A refunded or partially refunded payment is finished. A paid one is finished too, but only
    /// once something has read the charge — the webhook records the status without the settlement
    /// figures, so an unsynced payment still needs the round trip that fills them in.
    /// </remarks>
    private static bool NeedsProviderSync(Payment payment) =>
        payment.Status switch
        {
            PaymentStatus.Refunded or PaymentStatus.PartiallyRefunded => false,
            PaymentStatus.Paid => payment.LastSyncedAt is null,
            _ => true,
        };

    private static ConfirmCheckoutSessionResponse Describe(Payment payment)
    {
        var confirmed = payment.Status is PaymentStatus.Paid
            or PaymentStatus.PartiallyRefunded
            or PaymentStatus.Refunded;

        // The money can arrive for an order that no longer exists — a hosted page the restaurant
        // could not close, finished by a customer who still had the tab open. The payment really
        // did succeed, so every check above says confirmed, and saying only that left the customer
        // reading "your payment and order status are now up to date" about an order the kitchen had
        // rejected and a refund already on its way back to them.
        var turnedAway = payment.Order is not null
            && payment.Order.Status is OrderStatus.Cancelled or OrderStatus.Rejected;

        return new ConfirmCheckoutSessionResponse
        {
            PaymentStatus = payment.Status.ToString(),
            Confirmed = confirmed,
            OrderTurnedAway = turnedAway,
            // The same sentence the refund email carries, so the screen and the inbox agree.
            Message = turnedAway
                ? TurnedAwayOrderRefund.CustomerExplanation(payment.Order!.Status)
                : confirmed
                    ? "Payment confirmed."
                    : "Payment is still being processed by Stripe."
        };
    }

    /// Manual recovery path: pulls the authoritative state from Stripe for a payment stranded by a
    /// dropped webhook, and fills in the settlement figures that only exist on the charge.
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("{paymentId:guid}/sync")]
    public async Task<ActionResult<AdminPaymentResponse>> SyncPayment(
        Guid paymentId,
        CancellationToken cancellationToken)
    {
        var payment = await _dbContext.Payments
            .Include(item => item.Order)
                .ThenInclude(order => order!.Restaurant)
            .Include(item => item.Order)
                .ThenInclude(order => order!.Customer)
            .Include(item => item.Refunds)
                .ThenInclude(refund => refund.Items)
            .FirstOrDefaultAsync(item => item.Id == paymentId, cancellationToken);

        if (payment is null)
        {
            return NotFound(new { message = "Payment not found." });
        }

        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) &&
            (currentRestaurantId is null || payment.Order?.RestaurantId != currentRestaurantId))
        {
            return Forbid();
        }

        // Through the session, not straight to the payment intent. An expired Checkout session leaves
        // an intent Stripe reports as canceled, so going directly recorded the payment as Cancelled —
        // which reads as "somebody cancelled this" when what happened is that the customer walked away
        // and the session timed out. Only the session itself can tell those apart, and the difference
        // is what staff act on. Payments with no session fall through to the intent as before.
        var result = await _paymentSyncService.SyncCheckoutSessionAsync(
            payment,
            User.FindFirstValue(ClaimTypes.NameIdentifier),
            cancellationToken);

        // An expired session is a definite answer, not a failed sync: the state has just been written
        // and the person who pressed Re-sync should be shown it, not an error over a stale row.
        if (!result.IsSuccess && !result.StateIsSettled)
        {
            return StatusCode(result.StatusCode, new { message = result.Message });
        }

        return Ok(MapToAdminPaymentResponse(payment));
    }

    /// Re-sends the Stripe receipt to the payer. Staff-initiated, because Stripe only emails the
    /// receipt automatically once, and only in live mode.
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("{paymentId:guid}/receipt/resend")]
    public async Task<IActionResult> ResendReceipt(Guid paymentId, CancellationToken cancellationToken)
    {
        var payment = await _dbContext.Payments
            .Include(item => item.Order)
                .ThenInclude(order => order!.Customer)
            .FirstOrDefaultAsync(item => item.Id == paymentId, cancellationToken);

        if (payment is null)
        {
            return NotFound(new { message = "Payment not found." });
        }

        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) &&
            (currentRestaurantId is null || payment.Order?.RestaurantId != currentRestaurantId))
        {
            return Forbid();
        }

        if (payment.Order is null)
        {
            return Conflict(new { message = "Payment is missing its order." });
        }

        if (string.IsNullOrWhiteSpace(payment.ProviderReceiptUrl))
        {
            return Conflict(new
            {
                message = "No Stripe receipt is available yet. Re-sync this payment from Stripe first."
            });
        }

        var recipient = PaymentNotificationService.ResolveRecipient(payment.Order, payment);
        if (string.IsNullOrWhiteSpace(recipient))
        {
            return Conflict(new { message = "This payment has no customer email to send a receipt to." });
        }

        await _paymentNotificationService.SendReceiptAsync(payment.Order, payment, cancellationToken);

        _reportLogWriter.AddAudit(
            "Payment.ReceiptResent",
            "Payment",
            payment.Id.ToString(),
            payment.Order.RestaurantId,
            $"Receipt for {payment.Order.OrderNumber} re-sent to the customer.",
            after: new { paymentId = payment.Id, payment.OrderId, recipient });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { message = $"Receipt sent to {recipient}." });
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
                .ThenInclude(refund => refund.Items)
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
            var pattern = SearchPattern.Contains(search);
            query = query.Where(payment =>
                EF.Functions.ILike(payment.Id.ToString(), pattern, SearchPattern.EscapeCharacter) ||
                (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern, SearchPattern.EscapeCharacter)) ||
                (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern, SearchPattern.EscapeCharacter)) ||
                (payment.Order != null && EF.Functions.ILike(payment.Order.OrderNumber, pattern, SearchPattern.EscapeCharacter)) ||
                (payment.Order != null && payment.Order.Restaurant != null && EF.Functions.ILike(payment.Order.Restaurant.Name, pattern, SearchPattern.EscapeCharacter)) ||
                (payment.Order != null && payment.Order.Customer != null && payment.Order.Customer.FullName != null && EF.Functions.ILike(payment.Order.Customer.FullName, pattern, SearchPattern.EscapeCharacter)) ||
                (payment.Order != null && payment.Order.Customer != null && payment.Order.Customer.Email != null && EF.Functions.ILike(payment.Order.Customer.Email, pattern, SearchPattern.EscapeCharacter)));
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

        if (!RefundAmountPolicy.IsValidOverrideAmount(request?.AmountCents))
        {
            return BadRequest(new { message = "Refund amount must be greater than zero." });
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

        // A crash between claiming a request and creating its refund would otherwise strand it in
        // Processing forever, so a stale claim that never produced a refund may be taken over.
        var reclaimableAt = DateTime.UtcNow - RefundRequestClaimPolicy.StaleClaimAge;
        var isReclaimableClaim = RefundRequestClaimPolicy.IsStaleClaim(
            refundRequest.Status,
            refundRequest.PaymentRefundId,
            refundRequest.UpdatedAt,
            reclaimableAt);

        if (refundRequest.Status != PaymentRefundRequestStatus.Pending && !isReclaimableClaim)
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

        var requestedAllocations = refundRequest.Items
            .Select(item => new RefundItemAllocation(
                item.OrderItemId,
                item.MenuItemNameSnapshot,
                item.Quantity,
                item.AmountCents,
                // Carried from the request: staff approve what the customer asked for, and the
                // extra they asked about must survive the approval that grants it.
                item.OrderItemOptionId))
            .ToList();

        long approvedAmountCents;
        IReadOnlyList<RefundItemAllocation> approvedAllocations;

        if (request?.Items is { Count: > 0 } chosenItems)
        {
            // Two answers to "how much" is a mistake to surface rather than one to pick a winner for.
            if (request.AmountCents is not null)
            {
                return BadRequest(new
                {
                    message = "Send either a total or a per-item breakdown, not both."
                });
            }

            var chosen = RefundRequestItemPolicy.AllocateStaffChosenRefund(
                requestedAllocations,
                chosenItems.Select(item => (item.OrderItemId, item.AmountCents)).ToList());

            if (!chosen.IsValid)
            {
                return BadRequest(new { message = chosen.Error });
            }

            approvedAmountCents = chosen.ApprovedAmountCents;
            approvedAllocations = chosen.Allocations;
        }
        else
        {
            approvedAmountCents = request?.AmountCents ?? refundRequest.RequestedAmountCents;

            if (!RefundAmountPolicy.IsWithinRequestedAmount(refundRequest.RequestedAmountCents, approvedAmountCents))
            {
                return BadRequest(new
                {
                    message = $"Approved amount must be greater than zero and cannot exceed the requested amount ({refundRequest.RequestedAmountCents} cents)."
                });
            }

            approvedAllocations = RefundRequestItemPolicy.AllocateApprovedRefund(
                approvedAmountCents,
                requestedAllocations);
        }

        var claimedAt = DateTime.UtcNow;
        var claimedRows = await _dbContext.PaymentRefundRequests
            .Where(item =>
                item.Id == requestId &&
                (item.Status == PaymentRefundRequestStatus.Pending ||
                    (item.Status == PaymentRefundRequestStatus.Processing &&
                        item.PaymentRefundId == null &&
                        item.UpdatedAt != null &&
                        item.UpdatedAt < reclaimableAt)))
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
                approvedAmountCents,
                refundRequest.Id,
                approvedAllocations);
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
        CloseOrderIfFullyRefunded(refundRequest.Order, userId, now);

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

        if (refundRequest.Order is not null)
        {
            await _paymentNotificationService.SendRefundRejectedAsync(
                refundRequest.Order,
                refundRequest.Payment,
                refundRequest.RequesterEmail,
                note,
                cancellationToken);
        }

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

        if (!await CanStartCheckoutSessionForOrderAsync(order, request.GuestAccessToken))
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

        if (!await CanStartCheckoutSessionForOrderAsync(order, request.GuestAccessToken))
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

        var refusal = OnlineCheckoutEligibility.Refuse(order.Status, order.PaymentStatus, order.PaymentMethod);
        if (refusal is not null)
        {
            return Conflict(new { message = refusal });
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
        catch (StripeWebhookNotReadyException ex)
            when (StripeWebhookRetryWindow.ShouldAskStripeToRetry(
                stripeEvent.Created.ToUniversalTime(), DateTime.UtcNow))
        {
            // Abandon the event id along with the work it stood for, so Stripe's retry arrives as a
            // new event rather than being answered "already seen". Recording it here is what lost
            // disputes outright: the payment row was simply not written yet, and the retry that would
            // have caught it was turned away at the door.
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogWarning(
                ex,
                "Stripe event {EventId} ({EventType}) arrived before its payment existed. Asking Stripe to retry.",
                stripeEvent.Id,
                stripeEvent.Type);

            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "The payment this event refers to is not available yet. Please retry.",
                eventId = stripeEvent.Id
            });
        }
        catch (StripeWebhookNotReadyException ex)
        {
            // Past the retry window this is no longer a race — it is an event that will never match,
            // and continuing to fail would have Stripe disable the endpoint and stop delivering
            // everything else. Bank it and make the gap loud instead.
            _logger.LogError(
                ex,
                "Stripe event {EventId} ({EventType}) never found its payment within {Hours}h and has been recorded unmatched.",
                stripeEvent.Id,
                stripeEvent.Type,
                StripeWebhookRetryWindow.Duration.TotalHours);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            return Ok(new { received = true, unmatched = true });
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
            .Include(refund => refund.Items)
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
                    .ThenInclude(refund => refund.Items)
            .Include(request => request.PaymentRefund)
                .ThenInclude(refund => refund!.Items)
            .Include(request => request.Items)
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

        var pattern = SearchPattern.Contains(search);
        return query.Where(request =>
            (request.Reason != null && EF.Functions.ILike(request.Reason, pattern, SearchPattern.EscapeCharacter)) ||
            (request.AdminNote != null && EF.Functions.ILike(request.AdminNote, pattern, SearchPattern.EscapeCharacter)) ||
            (request.RequesterName != null && EF.Functions.ILike(request.RequesterName, pattern, SearchPattern.EscapeCharacter)) ||
            (request.RequesterEmail != null && EF.Functions.ILike(request.RequesterEmail, pattern, SearchPattern.EscapeCharacter)) ||
            (request.Order != null && EF.Functions.ILike(request.Order.OrderNumber, pattern, SearchPattern.EscapeCharacter)) ||
            (request.Order != null && request.Order.Restaurant != null && EF.Functions.ILike(request.Order.Restaurant.Name, pattern, SearchPattern.EscapeCharacter)) ||
            (request.Order != null && request.Order.Customer != null && request.Order.Customer.Email != null && EF.Functions.ILike(request.Order.Customer.Email, pattern, SearchPattern.EscapeCharacter)));
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

        var pattern = SearchPattern.Contains(search);
        return query.Where(refund =>
            (refund.ProviderRefundId != null && EF.Functions.ILike(refund.ProviderRefundId, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.ProviderPaymentIntentId != null && EF.Functions.ILike(refund.ProviderPaymentIntentId, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.Reason != null && EF.Functions.ILike(refund.Reason, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.FailureReason != null && EF.Functions.ILike(refund.FailureReason, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.Payment != null && refund.Payment.Order != null && EF.Functions.ILike(refund.Payment.Order.OrderNumber, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.Restaurant != null && EF.Functions.ILike(refund.Payment.Order.Restaurant.Name, pattern, SearchPattern.EscapeCharacter)) ||
            (refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.Customer != null && refund.Payment.Order.Customer.Email != null && EF.Functions.ILike(refund.Payment.Order.Customer.Email, pattern, SearchPattern.EscapeCharacter)));
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
            UnattributedAmountCents = Math.Max(0, refund.AmountCents - refund.Items.Sum(item => item.AmountCents)),
            Items = refund.Items
                .OrderBy(item => item.MenuItemNameSnapshot)
                .ThenBy(item => item.OrderItemId)
                .Select(item => new AdminPaymentRefundItemResponse
                {
                    OrderItemId = item.OrderItemId,
                    MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                    Quantity = item.Quantity,
                    AmountCents = item.AmountCents
                })
                .ToList(),
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
            ReviewedAt = request.ReviewedAt,
            Items = request.Items
                .Select(item => new AdminRefundRequestItemResponse
                {
                    OrderItemId = item.OrderItemId,
                    MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                    Quantity = item.Quantity,
                    AmountCents = item.AmountCents
                })
                .ToList()
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
            ProviderChargeId = payment.ProviderChargeId,
            StripeAccountId = payment.StripeAccountId,
            PlatformFeeAmountCents = payment.PlatformFeeAmountCents,
            StripeFeeAmountCents = payment.StripeFeeAmountCents,
            NetAmountCents = payment.NetAmountCents,
            ProviderReceiptUrl = payment.ProviderReceiptUrl,
            ReceiptEmail = payment.ReceiptEmail,
            DisputeId = payment.DisputeId,
            DisputeStatus = payment.DisputeStatus,
            DisputeAmountCents = payment.DisputeAmountCents,
            DisputeEvidenceDueBy = payment.DisputeEvidenceDueBy,
            DisputeReason = payment.DisputeReason,
            DisputedAt = payment.DisputedAt,
            LastProviderEventCreatedAt = payment.LastProviderEventCreatedAt,
            LastSyncedAt = payment.LastSyncedAt,
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
            UnattributedAmountCents = Math.Max(0, refund.AmountCents - refund.Items.Sum(item => item.AmountCents)),
            Items = refund.Items
                .OrderBy(item => item.MenuItemNameSnapshot)
                .ThenBy(item => item.OrderItemId)
                .Select(item => new AdminPaymentRefundItemResponse
                {
                    OrderItemId = item.OrderItemId,
                    MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                    Quantity = item.Quantity,
                    AmountCents = item.AmountCents
                })
                .ToList(),
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

    private static string AddCheckoutSessionId(string url) =>
        StripeCheckoutReturnUrl.WithSessionId(url);

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
            throw new StripeWebhookNotReadyException(
                $"No payment found for Stripe checkout session {session.Id}.");
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
                // Not TryAccept directly: a payment can land on an order the restaurant already
                // turned away, and that money has to go back rather than be quietly kept.
                await _orderPaymentLanding.OnPaidAsync(payment.Order, actorUserId: null, cancellationToken);
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
            throw new StripeWebhookNotReadyException(
                $"No payment found for Stripe payment intent {paymentIntent.Id}.");
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
                // Not TryAccept directly: a payment can land on an order the restaurant already
                // turned away, and that money has to go back rather than be quietly kept.
                await _orderPaymentLanding.OnPaidAsync(payment.Order, actorUserId: null, cancellationToken);
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
            throw new StripeWebhookNotReadyException(
                $"No payment found for Stripe refund {stripeRefund.Id} with payment intent {stripeRefund.PaymentIntentId}.");
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

        // Stripe does not guarantee webhook ordering, so a refund carries its own provider event
        // clock: anything older than what we already applied is dropped.
        var refundEventCreatedAt = stripeEvent.Created.ToUniversalTime();
        if (localRefund.LastProviderEventCreatedAt.HasValue &&
            localRefund.LastProviderEventCreatedAt.Value > refundEventCreatedAt)
        {
            _logger.LogInformation(
                "Ignored out-of-order Stripe event {EventId} for refund {RefundId}.",
                stripeEvent.Id,
                localRefund.Id);
            return;
        }

        var incomingRefundStatus = MapStripeRefundStatus(stripeRefund.Status);
        if (!RefundStatePolicy.CanApplyProviderStatus(localRefund.Status, incomingRefundStatus))
        {
            _logger.LogInformation(
                "Ignored Stripe event {EventId} transition for refund {RefundId}: {CurrentStatus} -> {IncomingStatus}.",
                stripeEvent.Id,
                localRefund.Id,
                localRefund.Status,
                incomingRefundStatus);
            return;
        }

        localRefund.ProviderRefundId = stripeRefund.Id;
        localRefund.ProviderPaymentIntentId = stripeRefund.PaymentIntentId ?? payment.ProviderPaymentIntentId;
        localRefund.AmountCents = stripeRefund.Amount;
        localRefund.Currency = NormalizeCurrency(stripeRefund.Currency ?? payment.Currency);
        localRefund.Status = incomingRefundStatus;
        localRefund.FailureReason = stripeRefund.FailureReason;
        localRefund.LastProviderEventCreatedAt = refundEventCreatedAt;
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
        await SynchronizeRefundRequestFromProviderAsync(localRefund, now, cancellationToken);
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
            throw new StripeWebhookNotReadyException(
                $"No payment found for refunded Stripe charge {charge.Id} with payment intent {charge.PaymentIntentId}.");
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
            throw new StripeWebhookNotReadyException(
                $"No payment found for Stripe dispute {dispute.Id}.");
        }

        if (!IsStripeEventForPayment(payment, stripeEvent))
        {
            return;
        }

        // Same ordering rule the payment and refund handlers use: Stripe does not guarantee webhook
        // order, so a stale dispute.updated must not reopen a dispute that has already closed.
        var disputeEventCreatedAt = stripeEvent.Created.ToUniversalTime();
        if (payment.LastDisputeEventCreatedAt.HasValue &&
            payment.LastDisputeEventCreatedAt.Value > disputeEventCreatedAt)
        {
            _logger.LogInformation(
                "Ignored out-of-order Stripe event {EventId} for dispute {DisputeId}.",
                stripeEvent.Id,
                dispute.Id);
            return;
        }

        // Persist the dispute so operators can see it on the payment itself; the audit trail below
        // keeps the full history but is not queryable from the payments UI.
        payment.DisputeId = dispute.Id;
        payment.DisputeStatus = dispute.Status;
        payment.DisputeReason = dispute.Reason;
        payment.DisputeAmountCents = dispute.Amount;
        // Null once the dispute closes, which is exactly when the deadline should stop showing.
        payment.DisputeEvidenceDueBy = dispute.EvidenceDetails?.DueBy?.ToUniversalTime();
        payment.DisputedAt ??= dispute.Created == default ? DateTime.UtcNow : dispute.Created.ToUniversalTime();
        payment.LastDisputeEventCreatedAt = disputeEventCreatedAt;
        payment.UpdatedAt = DateTime.UtcNow;

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
        // Defensive: a webhook that throws is answered with a 500, and Stripe then retries it for
        // days without ever getting anywhere. Real events always carry a metadata object, but a
        // refund event that reaches us without one must be handled, not thrown at.
        if (stripeRefund.Metadata is not null &&
            stripeRefund.Metadata.TryGetValue(PaymentIdMetadataKey, out var paymentId) &&
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
        if (stripeRefund.Metadata is not null &&
            stripeRefund.Metadata.TryGetValue(RefundIdMetadataKey, out var refundId) &&
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
        if (stripeRefund.Metadata is not null &&
            stripeRefund.Metadata.TryGetValue("reason", out var metadataReason) &&
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
        var nextStatus = RefundAggregateStatus.Resolve(
            payment.Status,
            payment.AmountCents,
            GetSucceededRefundedAmount(payment));

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

    private async Task SynchronizeRefundRequestFromProviderAsync(
        PaymentRefund refund,
        DateTime updatedAt,
        CancellationToken cancellationToken)
    {
        var refundRequests = await _dbContext.PaymentRefundRequests
            .Where(request => request.PaymentRefundId == refund.Id)
            .ToListAsync(cancellationToken);

        foreach (var refundRequest in refundRequests)
        {
            if (refund.Status == PaymentRefundStatus.Succeeded)
            {
                refundRequest.Status = PaymentRefundRequestStatus.Approved;
                refundRequest.ReviewedAt ??= updatedAt;
            }
            else if (refund.Status == PaymentRefundStatus.Failed)
            {
                refundRequest.Status = PaymentRefundRequestStatus.Pending;
                refundRequest.PaymentRefundId = null;
            }
            else
            {
                refundRequest.Status = PaymentRefundRequestStatus.Processing;
            }

            refundRequest.UpdatedAt = updatedAt;
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
            .Include(request => request.Order)
                .ThenInclude(order => order!.OrderItems)
                    // Approving a refund prices what it is for, and an extra's price lives on the
                    // line's own option rows. Without them every extra reads as no longer
                    // refundable, which is a refusal the customer can do nothing about.
                    .ThenInclude(orderItem => orderItem.SelectedOptions)
            .Include(request => request.Payment)
            .Include(request => request.PaymentRefund)
            .Include(request => request.Items)
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
                item.Status == PaymentRefundRequestStatus.Processing &&
                item.PaymentRefundId == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(item => item.Status, PaymentRefundRequestStatus.Pending)
                    .SetProperty(item => item.UpdatedAt, DateTime.UtcNow),
                cancellationToken);

    /// <summary>
    /// Calls an order off once the customer has been paid back in full and nothing has been handed
    /// over yet.
    /// </summary>
    /// <remarks>
    /// Refunding and closing were separate acts, so a fully refunded order could sit in the kitchen
    /// still reading as Accepted: the pass is told to cook it, the customer is told they have their
    /// money back, and neither side can see the other. <see cref="RefundedOrderClosure"/> holds the
    /// line about when this applies — an order already ready or completed keeps its history, because
    /// the food exists and rewriting it as cancelled would record a day that did not happen.
    /// </remarks>
    private void CloseOrderIfFullyRefunded(Order? order, string? actorUserId, DateTime now)
    {
        if (order is null)
        {
            return;
        }

        var paidCents = order.Payments
            .Where(payment => payment.Status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded)
            .Sum(payment => payment.AmountCents);
        var refundedCents = order.Payments
            .SelectMany(payment => payment.Refunds)
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

        var closure = RefundedOrderClosure.ClosureFor(order.Status, paidCents, refundedCents);

        if (closure is null)
        {
            return;
        }

        var previousStatus = order.Status;
        order.Status = closure.Value;
        order.UpdatedAt = now;

        _dbContext.OrderStatusHistories.Add(new OrderStatusHistory
        {
            OrderId = order.Id,
            PreviousStatus = previousStatus,
            NewStatus = closure.Value,
            Action = OrderTransitionAction.Cancel.ToString(),
            Reason = RefundedOrderClosure.CustomerExplanation,
            ChangedByUserId = actorUserId,
            CreatedAt = now,
        });

        _reportLogWriter.AddOrderEvent(
            order,
            "order.closed_after_full_refund",
            $"{order.OrderNumber}: {previousStatus} -> {closure.Value} after a full refund.",
            new { previousStatus = previousStatus.ToString(), newStatus = closure.Value.ToString() });
    }

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

    private async Task<bool> CanStartCheckoutSessionForOrderAsync(Order order, string? guestAccessToken)
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

        // A guest order used to end here on an unconditional "yes": knowing the order id was enough
        // to mint a Stripe session for somebody else's order, which both discloses what they ordered
        // and leaves the order marked as having a payment in flight — locking its real owner out of
        // changing how they pay. Orders placed before tokens existed carry no hash and stay
        // reachable, which is the same allowance every other guest route makes.
        return GuestAccessTokenService.IsAuthorized(order.GuestAccessTokenHash, guestAccessToken);
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
