using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Extensions;
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
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/admin/orders")]
[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public class AdminOrdersController : ControllerBase
{
    private static readonly string[] DemoOrderItemNames =
    [
        "Butter Chicken", "Mango Lassi", "Grilled Salmon", "Veg Fried Rice",
        "Chicken Wings", "Mushroom Pasta", "Paneer Tikka Skewers", "Masala Cola",
        "Garlic Bread", "Chocolate Lava Cake", "Tandoori Chicken", "Fresh Lime Soda"
    ];

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly OrderAutoAcceptanceService _orderAutoAcceptanceService;
    private readonly OrderRefundProcessor _orderRefundProcessor;
    private readonly ReportLogWriter _reportLogWriter;

    public AdminOrdersController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        OrderRealtimeNotifier orderRealtimeNotifier,
        OrderAutoAcceptanceService orderAutoAcceptanceService,
        OrderRefundProcessor orderRefundProcessor,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _orderAutoAcceptanceService = orderAutoAcceptanceService;
        _orderRefundProcessor = orderRefundProcessor;
        _reportLogWriter = reportLogWriter;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<AdminOrderResponse>>> GetOrders(
        [FromQuery] AdminOrderListRequest request,
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

        var query = _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(order => order.RestaurantId == currentRestaurantId);
        }

        if (request.RestaurantId.HasValue)
        {
            query = query.Where(order => order.RestaurantId == request.RestaurantId);
        }

        if (!TryParseFilter<OrderStatus>(request.Status, nameof(request.Status), out var orderStatus, out var filterError) ||
            !TryParseFilter<PaymentStatus>(request.PaymentStatus, nameof(request.PaymentStatus), out var paymentStatus, out filterError) ||
            !TryParseFilter<OrderType>(request.OrderType, nameof(request.OrderType), out var orderType, out filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (orderStatus.HasValue)
        {
            query = query.Where(order => order.Status == orderStatus.Value);
        }

        if (paymentStatus.HasValue)
        {
            query = query.Where(order => order.PaymentStatus == paymentStatus.Value);
        }

        if (orderType.HasValue)
        {
            query = query.Where(order => order.OrderType == orderType.Value);
        }

        if (request.PayableOnly == true)
        {
            query = query.Where(order =>
                order.PaymentMethod == PaymentMethod.Online &&
                (order.PaymentStatus == PaymentStatus.Pending ||
                 order.PaymentStatus == PaymentStatus.Unpaid ||
                 order.PaymentStatus == PaymentStatus.Failed ||
                 order.PaymentStatus == PaymentStatus.Cancelled ||
                 order.PaymentStatus == PaymentStatus.Expired) &&
                order.Status != OrderStatus.Cancelled &&
                order.Status != OrderStatus.Rejected);
        }

        if (request.CreatedFromUtc.HasValue)
        {
            query = query.Where(order => order.CreatedAt >= request.CreatedFromUtc.Value);
        }

        if (request.CreatedToUtc.HasValue)
        {
            query = query.Where(order => order.CreatedAt < request.CreatedToUtc.Value);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            var pickupSearch = search.TrimStart('#');
            var hasPickupNumber = int.TryParse(pickupSearch, out var pickupNumber);
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern) ||
                (hasPickupNumber && order.PickupNumber == pickupNumber) ||
                (order.Restaurant != null && EF.Functions.ILike(order.Restaurant.Name, pattern)) ||
                (order.Customer != null && order.Customer.FullName != null && EF.Functions.ILike(order.Customer.FullName, pattern)) ||
                (order.Customer != null && order.Customer.Email != null && EF.Functions.ILike(order.Customer.Email, pattern)) ||
                (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern)) ||
                order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern)) ||
                order.Payments.Any(payment =>
                    (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern)) ||
                    (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern))));
        }

        var sortedQuery = ApplySorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "updatedAt", "orderNumber", "restaurantName", "status", "paymentStatus", "totalAmount" }
            });
        }

        var page = await sortedQuery
            .AsSplitQuery()
            .ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(new PagedResponse<AdminOrderResponse>
        {
            Items = page.Items.Select(MapToAdminResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }

    [HttpGet("summary")]
    public async Task<ActionResult<AdminOrderSummaryResponse>> GetOrderSummary(
        [FromQuery] AdminOrderListRequest request,
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

        var query = _dbContext.Orders.AsNoTracking().AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(order => order.RestaurantId == currentRestaurantId);
        }

        if (request.RestaurantId.HasValue)
        {
            query = query.Where(order => order.RestaurantId == request.RestaurantId);
        }

        if (!TryParseFilter<OrderStatus>(request.Status, nameof(request.Status), out var orderStatus, out var filterError) ||
            !TryParseFilter<PaymentStatus>(request.PaymentStatus, nameof(request.PaymentStatus), out var paymentStatus, out filterError) ||
            !TryParseFilter<OrderType>(request.OrderType, nameof(request.OrderType), out var orderType, out filterError))
        {
            return BadRequest(new { message = filterError });
        }

        if (orderStatus.HasValue)
        {
            query = query.Where(order => order.Status == orderStatus.Value);
        }

        if (paymentStatus.HasValue)
        {
            query = query.Where(order => order.PaymentStatus == paymentStatus.Value);
        }

        if (orderType.HasValue)
        {
            query = query.Where(order => order.OrderType == orderType.Value);
        }

        if (request.PayableOnly == true)
        {
            query = query.Where(order =>
                order.PaymentMethod == PaymentMethod.Online &&
                (order.PaymentStatus == PaymentStatus.Pending ||
                 order.PaymentStatus == PaymentStatus.Unpaid ||
                 order.PaymentStatus == PaymentStatus.Failed ||
                 order.PaymentStatus == PaymentStatus.Cancelled ||
                 order.PaymentStatus == PaymentStatus.Expired) &&
                order.Status != OrderStatus.Cancelled &&
                order.Status != OrderStatus.Rejected);
        }

        if (request.CreatedFromUtc.HasValue)
        {
            query = query.Where(order => order.CreatedAt >= request.CreatedFromUtc.Value);
        }

        if (request.CreatedToUtc.HasValue)
        {
            query = query.Where(order => order.CreatedAt < request.CreatedToUtc.Value);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            var pickupSearch = search.TrimStart('#');
            var hasPickupNumber = int.TryParse(pickupSearch, out var pickupNumber);
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern) ||
                (hasPickupNumber && order.PickupNumber == pickupNumber) ||
                (order.Restaurant != null && EF.Functions.ILike(order.Restaurant.Name, pattern)) ||
                (order.Customer != null && order.Customer.FullName != null && EF.Functions.ILike(order.Customer.FullName, pattern)) ||
                (order.Customer != null && order.Customer.Email != null && EF.Functions.ILike(order.Customer.Email, pattern)) ||
                (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern)) ||
                order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern)) ||
                order.Payments.Any(payment =>
                    (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern)) ||
                    (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern))));
        }

        var summary = await query
            .GroupBy(_ => 1)
            .Select(group => new AdminOrderSummaryResponse
            {
                Total = group.Count(),
                ActiveKitchen = group.Count(order =>
                    order.Status == OrderStatus.Pending ||
                    order.Status == OrderStatus.Accepted ||
                    order.Status == OrderStatus.Preparing ||
                    order.Status == OrderStatus.Ready),
                Paid = group.Count(order => order.PaymentStatus == PaymentStatus.Paid),
                PendingPayment = group.Count(order => order.PaymentStatus == PaymentStatus.Pending),
                FailedPayment = group.Count(order => order.PaymentStatus == PaymentStatus.Failed),
                Payable = group.Count(order =>
                    order.PaymentMethod == PaymentMethod.Online &&
                    (order.PaymentStatus == PaymentStatus.Pending ||
                     order.PaymentStatus == PaymentStatus.Unpaid ||
                     order.PaymentStatus == PaymentStatus.Failed ||
                     order.PaymentStatus == PaymentStatus.Cancelled ||
                     order.PaymentStatus == PaymentStatus.Expired) &&
                    order.Status != OrderStatus.Cancelled &&
                    order.Status != OrderStatus.Rejected),
                Revenue = group
                    .Where(order => order.PaymentStatus == PaymentStatus.Paid)
                    .Sum(order => order.TotalAmount)
            })
            .SingleOrDefaultAsync(cancellationToken);

        return Ok(summary ?? new AdminOrderSummaryResponse());
    }

    [HttpPost("{orderId:guid}/counter-payment")]
    public async Task<ActionResult<AdminOrderResponse>> RecordCounterPayment(
        Guid orderId,
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

        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.Customer)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && order.RestaurantId != currentRestaurantId)
        {
            return Forbid();
        }

        if (order.PaymentMethod != PaymentMethod.PayAtCounter)
        {
            return Conflict(new { message = "Only pay-at-counter orders can be settled at the counter." });
        }

        if (OrderPaymentEligibility.IsSettledForFulfillment(order.PaymentStatus))
        {
            return Ok(MapToAdminResponse(order));
        }

        if (order.PaymentStatus == PaymentStatus.Refunded)
        {
            return Conflict(new { message = "Fully refunded orders cannot be charged again." });
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return Conflict(new { message = "Cancelled or rejected orders cannot be settled." });
        }

        var now = DateTime.UtcNow;
        var previousPaymentStatus = order.PaymentStatus;
        order.PaymentStatus = PaymentStatus.Paid;
        order.UpdatedAt = now;
        var counterPayment = new Payment
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            Order = order,
            Provider = PaymentProviders.Counter,
            AmountCents = PricingCalculator.ToMinorCurrencyUnits(order.TotalAmount),
            Currency = string.IsNullOrWhiteSpace(order.Restaurant?.Currency)
                ? "aud"
                : order.Restaurant.Currency.ToLowerInvariant(),
            Status = PaymentStatus.Paid,
            CreatedAt = now,
            UpdatedAt = now,
            PaidAt = now,
            RecordedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier)
        };
        _dbContext.Payments.Add(counterPayment);
        _reportLogWriter.AddAudit(
            "Payment.CounterRecorded",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Counter payment recorded for {order.OrderNumber}.",
            before: new
            {
                paymentStatus = previousPaymentStatus.ToString()
            },
            after: new
            {
                paymentStatus = order.PaymentStatus.ToString(),
                paymentId = counterPayment.Id,
                counterPayment.AmountCents,
                counterPayment.Currency
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "payment.counter_recorded",
            $"Counter payment recorded for {order.OrderNumber}.",
            new
            {
                paymentId = counterPayment.Id,
                counterPayment.AmountCents,
                counterPayment.Currency
            });
        _reportLogWriter.AddPaymentEvent(
            order,
            counterPayment,
            null,
            "counter.recorded",
            null,
            counterPayment.Status.ToString(),
            "Counter payment recorded.",
            new
            {
                counterPayment.AmountCents,
                counterPayment.Currency
            },
            PaymentProviders.Counter);

        await _orderAutoAcceptanceService.TryAcceptAsync(order, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);
        return Ok(MapToAdminResponse(order));
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("{orderId:guid}/refund")]
    public async Task<ActionResult<AdminOrderResponse>> RefundOrder(
        Guid orderId,
        RefundOrderRequest? request,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(request?.Reason) ? null : request.Reason.Trim();
        if (reason?.Length > 1_000)
        {
            return BadRequest(new { message = "Reason cannot exceed 1000 characters." });
        }

        if (!RefundAmountPolicy.IsValidOverrideAmount(request?.AmountCents))
        {
            return BadRequest(new { message = "Refund amount must be greater than zero." });
        }

        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Current user is not assigned to a restaurant."
            });
        }

        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.Customer)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && order.RestaurantId != currentRestaurantId)
        {
            return Forbid();
        }

        var result = await _orderRefundProcessor.RefundAsync(
            order,
            User.FindFirstValue(ClaimTypes.NameIdentifier),
            reason,
            "admin-direct",
            cancellationToken,
            requestedAmountCents: request?.AmountCents);
        if (!result.IsSuccess)
        {
            return StatusCode(result.StatusCode, new
            {
                message = result.Message,
                detail = result.Detail
            });
        }

        return Ok(MapToAdminResponse(order));
    }

    [HttpPost("{orderId:guid}/transitions")]
    public async Task<ActionResult<AdminOrderResponse>> TransitionOrder(
        Guid orderId,
        OrderTransitionRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<OrderTransitionAction>(request.Action, true, out var action) || !Enum.IsDefined(action))
        {
            return BadRequest(new
            {
                message = $"Action must be one of: {string.Join(", ", Enum.GetNames<OrderTransitionAction>())}."
            });
        }

        var reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason.Trim();
        if (reason?.Length > 1_000)
        {
            return BadRequest(new { message = "Reason cannot exceed 1000 characters." });
        }

        if (OrderStatusTransitions.RequiresReason(action) && reason is null)
        {
            return BadRequest(new { message = $"A reason is required for {action}." });
        }

        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && currentRestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Current user is not assigned to a restaurant."
            });
        }

        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.Customer)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) && order.RestaurantId != currentRestaurantId)
        {
            return Forbid();
        }

        if (!OrderStatusTransitions.TryGetNextStatus(order.Status, action, out var nextStatus))
        {
            return Conflict(new
            {
                message = $"Action {action} is not allowed while the order is {order.Status}.",
                currentStatus = order.Status.ToString(),
                availableActions = GetAvailableActions(order)
            });
        }

        if (RequiresPaymentEligibility(order, action) && !CanProcess(order))
        {
            return Conflict(new
            {
                message = "Only paid or pay-at-counter orders can enter the staff workflow.",
                paymentStatus = order.PaymentStatus.ToString(),
                paymentMethod = order.PaymentMethod.ToString()
            });
        }

        var previousStatus = order.Status;
        var now = DateTime.UtcNow;
        order.Status = nextStatus;
        order.UpdatedAt = now;
        var statusHistory = new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PreviousStatus = previousStatus,
            NewStatus = nextStatus,
            Action = action.ToString(),
            Reason = reason,
            ChangedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            CreatedAt = now
        };
        _dbContext.OrderStatusHistories.Add(statusHistory);
        _reportLogWriter.AddAudit(
            "Order.StatusChanged",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"{order.OrderNumber}: {previousStatus} -> {nextStatus}.",
            before: new
            {
                status = previousStatus.ToString()
            },
            after: new
            {
                status = nextStatus.ToString(),
                action = action.ToString(),
                reason
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "order.status_changed",
            $"{order.OrderNumber}: {previousStatus} -> {nextStatus}.",
            new
            {
                previousStatus = previousStatus.ToString(),
                nextStatus = nextStatus.ToString(),
                action = action.ToString(),
                reason
            });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderUpdatedAsync(order, cancellationToken);
        return Ok(MapToAdminResponse(order));
    }

    [HttpGet("{orderId:guid}/status-history")]
    public async Task<ActionResult<IReadOnlyList<OrderStatusHistoryResponse>>> GetStatusHistory(
        Guid orderId,
        CancellationToken cancellationToken)
    {
        var currentRestaurantId = await GetCurrentRestaurantIdAsync();
        var order = await _dbContext.Orders
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) &&
            (currentRestaurantId is null || order.RestaurantId != currentRestaurantId))
        {
            return Forbid();
        }

        var history = await _dbContext.OrderStatusHistories
            .AsNoTracking()
            .Where(item => item.OrderId == orderId)
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .Select(item => new OrderStatusHistoryResponse
            {
                Id = item.Id,
                PreviousStatus = item.PreviousStatus.ToString(),
                NewStatus = item.NewStatus.ToString(),
                Action = item.Action,
                Reason = item.Reason,
                ChangedByUserId = item.ChangedByUserId,
                CreatedAt = item.CreatedAt
            })
            .ToListAsync(cancellationToken);

        return Ok(history);
    }

    private static IOrderedQueryable<Infrastructure.Orders.Order>? ApplySorting(
        IQueryable<Infrastructure.Orders.Order> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim();

        IOrderedQueryable<Infrastructure.Orders.Order>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "createdat" => descending ? query.OrderByDescending(order => order.CreatedAt) : query.OrderBy(order => order.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(order => order.UpdatedAt) : query.OrderBy(order => order.UpdatedAt),
            "ordernumber" => descending ? query.OrderByDescending(order => order.OrderNumber) : query.OrderBy(order => order.OrderNumber),
            "restaurantname" => descending ? query.OrderByDescending(order => order.Restaurant!.Name) : query.OrderBy(order => order.Restaurant!.Name),
            "status" => descending ? query.OrderByDescending(order => order.Status) : query.OrderBy(order => order.Status),
            "paymentstatus" => descending ? query.OrderByDescending(order => order.PaymentStatus) : query.OrderBy(order => order.PaymentStatus),
            "totalamount" => descending ? query.OrderByDescending(order => order.TotalAmount) : query.OrderBy(order => order.TotalAmount),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(order => order.Id)
                : sorted.ThenBy(order => order.Id);
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

    private static Dictionary<string, string> BuildRefundMetadata(
        Infrastructure.Orders.Order order,
        Payment payment,
        PaymentRefund refund,
        string? reason)
    {
        var metadata = new Dictionary<string, string>
        {
            ["mode"] = "order-refund",
            ["orderId"] = order.Id.ToString(),
            ["orderNumber"] = order.OrderNumber,
            ["paymentId"] = payment.Id.ToString(),
            ["refundId"] = refund.Id.ToString()
        };

        if (!string.IsNullOrWhiteSpace(reason))
        {
            metadata["reason"] = TrimStripeMetadataValue(reason);
        }

        return metadata;
    }

    private static string TrimStripeMetadataValue(string value) =>
        value.Length <= 500 ? value : value[..500];

    private static PaymentRefundStatus MapStripeRefundStatus(string? status) =>
        status?.Trim().ToLowerInvariant() switch
        {
            "succeeded" => PaymentRefundStatus.Succeeded,
            "failed" or "canceled" => PaymentRefundStatus.Failed,
            _ => PaymentRefundStatus.Pending
        };

    private static long GetSucceededRefundedAmount(Payment payment) =>
        payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

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

    internal static AdminOrderResponse MapToAdminResponse(Infrastructure.Orders.Order order)
    {
        var latestPayment = order.Payments
            .OrderByDescending(payment => payment.CreatedAt)
            .ThenByDescending(payment => payment.Id)
            .FirstOrDefault();
        var latestRefundedAmountCents = latestPayment is null ? 0 : GetSucceededRefundedAmount(latestPayment);
        var latestRefundableAmountCents = latestPayment is null
            ? 0
            : Math.Max(0, latestPayment.AmountCents - latestRefundedAmountCents);
        var orderedItems = order.OrderItems
            .OrderBy(item => item.CreatedAt)
            .ThenBy(item => item.Id)
            .ToList();

        return new AdminOrderResponse
        {
            Id = order.Id,
            RestaurantId = order.RestaurantId,
            RestaurantName = order.Restaurant?.Name,
            Currency = string.IsNullOrWhiteSpace(order.Restaurant?.Currency) ? "AUD" : order.Restaurant!.Currency,
            TableId = order.TableId,
            TableNumber = order.Table?.TableNumber,
            CustomerId = order.CustomerId,
            CustomerName = order.Customer?.FullName,
            CustomerEmail = order.Customer?.Email,
            OrderNumber = order.OrderNumber,
            PickupDate = order.PickupDate,
            PickupNumber = order.PickupNumber,
            PickupCode = OrderPickupNumberService.FormatPickupCode(order.PickupNumber),
            TableSessionId = order.TableSessionId,
            OrderType = order.OrderType.ToString(),
            Status = order.Status.ToString(),
            PaymentStatus = order.PaymentStatus.ToString(),
            PaymentMethod = order.PaymentMethod.ToString(),
            CanProcess = CanProcess(order),
            AvailableActions = GetAvailableActions(order),
            TotalAmount = order.TotalAmount,
            CustomerNote = order.CustomerNote,
            ScheduledTime = order.ScheduledTime,
            CreatedAt = order.CreatedAt,
            UpdatedAt = order.UpdatedAt,
            PaymentAttempts = order.Payments.Count,
            LatestPayment = latestPayment is null
                ? null
                : new AdminOrderPaymentResponse
                {
                    Id = latestPayment.Id,
                    Provider = latestPayment.Provider,
                    Status = latestPayment.Status.ToString(),
                    AmountCents = latestPayment.AmountCents,
                    Currency = latestPayment.Currency,
                    ProviderCheckoutSessionId = latestPayment.ProviderCheckoutSessionId,
                    ProviderPaymentIntentId = latestPayment.ProviderPaymentIntentId,
                    ProviderChargeId = latestPayment.ProviderChargeId,
                    PlatformFeeAmountCents = latestPayment.PlatformFeeAmountCents,
                    StripeFeeAmountCents = latestPayment.StripeFeeAmountCents,
                    NetAmountCents = latestPayment.NetAmountCents,
                    ProviderReceiptUrl = latestPayment.ProviderReceiptUrl,
                    ReceiptEmail = latestPayment.ReceiptEmail,
                    DisputeId = latestPayment.DisputeId,
                    DisputeStatus = latestPayment.DisputeStatus,
                    DisputeAmountCents = latestPayment.DisputeAmountCents,
                    DisputeEvidenceDueBy = latestPayment.DisputeEvidenceDueBy,
                    DisputeReason = latestPayment.DisputeReason,
                    DisputedAt = latestPayment.DisputedAt,
                    LastProviderEventCreatedAt = latestPayment.LastProviderEventCreatedAt,
                    LastSyncedAt = latestPayment.LastSyncedAt,
                    FailureReason = latestPayment.FailureReason,
                    RefundCount = latestPayment.Refunds.Count,
                    RefundedAmountCents = latestRefundedAmountCents,
                    RefundableAmountCents = latestRefundableAmountCents,
                    HasPendingRefund = latestPayment.Refunds.Any(refund => refund.Status == PaymentRefundStatus.Pending),
                    Refunds = latestPayment.Refunds
                        .OrderByDescending(refund => refund.CreatedAt)
                        .ThenByDescending(refund => refund.Id)
                        .Select(MapToAdminPaymentRefundResponse)
                        .ToList(),
                    CreatedAt = latestPayment.CreatedAt,
                    UpdatedAt = latestPayment.UpdatedAt,
                    PaidAt = latestPayment.PaidAt,
                    FailedAt = latestPayment.FailedAt
                },
            Items = orderedItems
                .Select((item, index) => new AdminOrderItemResponse
                {
                    Id = item.Id,
                    MenuItemId = item.MenuItemId,
                    ItemNameSnapshot = ResolveItemNameSnapshot(order.OrderNumber, item.MenuItemNameSnapshot, index),
                    Quantity = item.Quantity,
                    UnitPrice = item.UnitPrice,
                    TotalPrice = PricingCalculator.CalculateLineTotal(item.Quantity, item.UnitPrice),
                    Note = item.ItemInstructions,
                    SelectedOptions = item.SelectedOptions
                        .OrderBy(option => option.GroupNameSnapshot)
                        .ThenBy(option => option.OptionNameSnapshot)
                        .ThenBy(option => option.Id)
                        .Select(option => new AdminOrderItemOptionResponse
                        {
                            Id = option.Id,
                            MenuItemOptionId = option.MenuItemOptionId,
                            GroupNameSnapshot = option.GroupNameSnapshot,
                            OptionNameSnapshot = option.OptionNameSnapshot,
                            PriceAdjustmentSnapshot = option.PriceAdjustmentSnapshot,
                            Quantity = option.Quantity
                        })
                        .ToList()
                })
                .ToList()
        };
    }

    private static string ResolveItemNameSnapshot(string orderNumber, string itemNameSnapshot, int itemIndex)
    {
        if (!string.IsNullOrWhiteSpace(itemNameSnapshot))
        {
            return itemNameSnapshot.Trim();
        }

        if (TryGetDemoOrderItemName(orderNumber, itemIndex, out var demoItemName))
        {
            return demoItemName;
        }

        return "Unnamed item";
    }

    private static bool TryGetDemoOrderItemName(string orderNumber, int itemIndex, out string itemName)
    {
        itemName = string.Empty;

        if (!orderNumber.StartsWith("DEMO-", StringComparison.OrdinalIgnoreCase) ||
            !int.TryParse(orderNumber["DEMO-".Length..], out var sequence) ||
            sequence < 1)
        {
            return false;
        }

        var orderIndex = sequence - 1;
        var itemNameIndex = itemIndex switch
        {
            0 => orderIndex % DemoOrderItemNames.Length,
            1 => (orderIndex * 5 + 3) % DemoOrderItemNames.Length,
            _ => -1
        };

        if (itemNameIndex < 0)
        {
            return false;
        }

        itemName = DemoOrderItemNames[itemNameIndex];
        return true;
    }

    private static bool CanProcess(Infrastructure.Orders.Order order) =>
        OrderPaymentEligibility.CanProcess(order.PaymentMethod, order.PaymentStatus);

    private static List<string> GetAvailableActions(Infrastructure.Orders.Order order) =>
        OrderStatusTransitions.GetAvailableActions(order.Status)
            .Where(action => !RequiresPaymentEligibility(order, action) || CanProcess(order))
            .Select(action => action.ToString())
            .ToList();

    private static bool RequiresPaymentEligibility(
        Infrastructure.Orders.Order order,
        OrderTransitionAction action) =>
        OrderStatusTransitions.RequiresPaymentEligibility(action) ||
        (order.Status == OrderStatus.Completed && action == OrderTransitionAction.Reopen);
}
