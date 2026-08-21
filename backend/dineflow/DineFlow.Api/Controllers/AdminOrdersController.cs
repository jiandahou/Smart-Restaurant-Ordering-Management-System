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
    private readonly StripeCheckoutSessionExpiry _checkoutSessionExpiry;
    private readonly ReportLogWriter _reportLogWriter;

    public AdminOrdersController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        OrderRealtimeNotifier orderRealtimeNotifier,
        OrderAutoAcceptanceService orderAutoAcceptanceService,
        OrderRefundProcessor orderRefundProcessor,
        StripeCheckoutSessionExpiry checkoutSessionExpiry,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _orderAutoAcceptanceService = orderAutoAcceptanceService;
        _orderRefundProcessor = orderRefundProcessor;
        _checkoutSessionExpiry = checkoutSessionExpiry;
        _reportLogWriter = reportLogWriter;
    }

    [HttpGet]
    public async Task<ActionResult<StaffOrderPageResponse>> GetOrders(
        [FromQuery] AdminOrderListRequest request,
        [FromQuery] string? queue,
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

        if (!string.IsNullOrWhiteSpace(queue) && !StaffOrderQueue.IsKnown(queue))
        {
            return BadRequest(new
            {
                message = "Unsupported queue value.",
                allowedValues = StaffOrderQueue.All
            });
        }

        // Filters first, without the related data. The queue counts are taken from this, and asking
        // for every order's items in order to count orders would read the whole order history to
        // answer a number on a tab.
        var query = _dbContext.Orders
            .AsNoTracking()
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
            // Mirrors OnlineCheckoutEligibility: this list is what puts a Checkout button in front of
            // staff, so anything on it that the checkout endpoint would refuse is an invitation to a
            // dead end. Completed used to be missing here, and completed-but-unpaid orders were
            // offered — and could be charged — as though they were ordinary unpaid bills.
            query = query.Where(order =>
                order.PaymentMethod == PaymentMethod.Online &&
                (order.PaymentStatus == PaymentStatus.Pending ||
                 order.PaymentStatus == PaymentStatus.Unpaid ||
                 order.PaymentStatus == PaymentStatus.Failed ||
                 order.PaymentStatus == PaymentStatus.Cancelled ||
                 order.PaymentStatus == PaymentStatus.Expired) &&
                !OnlineCheckoutEligibility.ClosedToOnlinePayment.Contains(order.Status));
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
            var pattern = SearchPattern.Contains(search);
            var pickupSearch = search.TrimStart('#');
            var hasPickupNumber = int.TryParse(pickupSearch, out var pickupNumber);
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern, SearchPattern.EscapeCharacter) ||
                (hasPickupNumber && order.PickupNumber == pickupNumber) ||
                (order.Restaurant != null && EF.Functions.ILike(order.Restaurant.Name, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Customer != null && order.Customer.FullName != null && EF.Functions.ILike(order.Customer.FullName, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Customer != null && order.Customer.Email != null && EF.Functions.ILike(order.Customer.Email, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern, SearchPattern.EscapeCharacter)) ||
                order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern, SearchPattern.EscapeCharacter)) ||
                order.Payments.Any(payment =>
                    (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern, SearchPattern.EscapeCharacter)) ||
                    (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern, SearchPattern.EscapeCharacter))));
        }

        var utcNow = DateTime.UtcNow;
        var queueCounts = await StaffOrderQueue.CountAsync(query, utcNow, cancellationToken);

        if (!string.IsNullOrWhiteSpace(queue))
        {
            query = query.Where(StaffOrderQueue.Predicate(queue, utcNow));
        }

        // Only now the related data, and only for the rows that will be returned.
        query = query
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
                    .ThenInclude(refund => refund.Items)
            .Include(order => order.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table);

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

        return Ok(new StaffOrderPageResponse
        {
            Items = page.Items.Select(MapToAdminResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems,
            QueueCounts = queueCounts
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
            var pattern = SearchPattern.Contains(search);
            var pickupSearch = search.TrimStart('#');
            var hasPickupNumber = int.TryParse(pickupSearch, out var pickupNumber);
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern, SearchPattern.EscapeCharacter) ||
                (hasPickupNumber && order.PickupNumber == pickupNumber) ||
                (order.Restaurant != null && EF.Functions.ILike(order.Restaurant.Name, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Customer != null && order.Customer.FullName != null && EF.Functions.ILike(order.Customer.FullName, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Customer != null && order.Customer.Email != null && EF.Functions.ILike(order.Customer.Email, pattern, SearchPattern.EscapeCharacter)) ||
                (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern, SearchPattern.EscapeCharacter)) ||
                order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern, SearchPattern.EscapeCharacter)) ||
                order.Payments.Any(payment =>
                    (payment.ProviderCheckoutSessionId != null && EF.Functions.ILike(payment.ProviderCheckoutSessionId, pattern, SearchPattern.EscapeCharacter)) ||
                    (payment.ProviderPaymentIntentId != null && EF.Functions.ILike(payment.ProviderPaymentIntentId, pattern, SearchPattern.EscapeCharacter))));
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
                // Settled, not literally Paid: a partly refunded order still took the money.
                Paid = group.Count(order => order.PaymentStatus == PaymentStatus.Paid
                    || order.PaymentStatus == PaymentStatus.PartiallyRefunded
                    || order.PaymentStatus == PaymentStatus.Refunded),
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
            })
            .SingleOrDefaultAsync(cancellationToken);

        // Grouped separately: adding amounts in different currencies produces a number that means
        // nothing, and this platform holds no exchange rates that could make one.
        // Settled, net of refunds — the rule is stated once in OrderRevenuePolicy and inlined here
        // because it has to run as SQL. Filtering on Paid alone dropped an order out of the takings
        // entirely the moment a dollar went back, so refunding A$1 of an A$26.61 order removed
        // A$26.61 from the day.
        var revenue = await query
            .Where(order => order.PaymentStatus == PaymentStatus.Paid
                || order.PaymentStatus == PaymentStatus.PartiallyRefunded
                || order.PaymentStatus == PaymentStatus.Refunded)
            // The order carries no currency of its own; it is whatever its restaurant trades in.
            .GroupBy(order => order.Restaurant!.Currency)
            .Select(group => new AdminOrderRevenueResponse
            {
                Currency = group.Key,
                Amount = group.Sum(order =>
                    order.TotalAmount
                    - order.Payments
                        .SelectMany(payment => payment.Refunds)
                        .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                        .Sum(refund => refund.AmountCents) / 100m),
                Orders = group.Count()
            })
            .OrderByDescending(entry => entry.Amount)
            .ToListAsync(cancellationToken);

        summary ??= new AdminOrderSummaryResponse();
        summary.Revenue = revenue;

        return Ok(summary);
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
                    .ThenInclude(refund => refund.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
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

        // Settling twice is the same money, not more of it: a repeated click answers with the order
        // rather than an error the operator has to interpret at a queue.
        if (order.PaymentMethod == PaymentMethod.PayAtCounter &&
            OrderPaymentEligibility.IsSettledForFulfillment(order.PaymentStatus))
        {
            return Ok(MapToAdminResponse(order));
        }

        // One rule, stated once. The screens mirror this predicate rather than each deciding for
        // themselves, which is how Admin Orders came to offer an action Admin Payments refused.
        if (!OrderPaymentEligibility.CanSettleAtCounter(order.PaymentMethod, order.PaymentStatus, order.Status))
        {
            return Conflict(new
            {
                message = OrderPaymentEligibility.DescribeCounterRefusal(
                    order.PaymentMethod,
                    order.PaymentStatus,
                    order.Status),
            });
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
                    .ThenInclude(refund => refund.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
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

        var requestedItems = request?.Items ?? [];
        if (requestedItems.GroupBy(item => item.OrderItemId).Any(group => group.Count() > 1))
        {
            return BadRequest(new { message = "Each order item can only appear once in a refund." });
        }

        var previousAllocations = RefundRequestItemPolicy.BuildAttributedRefundAmounts(order);
        var allocations = new List<RefundItemAllocation>();
        foreach (var requestedItem in requestedItems)
        {
            var orderItem = order.OrderItems.FirstOrDefault(item => item.Id == requestedItem.OrderItemId);
            if (orderItem is null)
            {
                return BadRequest(new { message = "A selected refund item does not belong to this order." });
            }

            var unitPriceCents = (long)Math.Round(
                orderItem.UnitPrice * 100m,
                MidpointRounding.AwayFromZero);
            var lineAmountCents = unitPriceCents * orderItem.Quantity;
            var remainingLineAmountCents = Math.Max(
                0,
                lineAmountCents - previousAllocations.GetValueOrDefault(orderItem.Id));
            var selectedQuantityAmountCents = unitPriceCents * requestedItem.Quantity;
            if (!RefundRequestItemPolicy.IsValidQuantity(requestedItem.Quantity, orderItem.Quantity)
                || !RefundRequestItemPolicy.IsValidAmount(
                    requestedItem.AmountCents,
                    selectedQuantityAmountCents,
                    remainingLineAmountCents))
            {
                return BadRequest(new
                {
                    message = $"Refund quantity or amount is invalid for {orderItem.MenuItemNameSnapshot}."
                });
            }

            allocations.Add(new RefundItemAllocation(
                orderItem.Id,
                orderItem.MenuItemNameSnapshot,
                requestedItem.Quantity,
                requestedItem.AmountCents));
        }

        var generalAdjustmentAmountCents = request?.GeneralAdjustmentAmountCents ?? 0;
        if (generalAdjustmentAmountCents < 0)
        {
            return BadRequest(new { message = "General adjustment amount cannot be negative." });
        }

        long? requestedAmountCents = request?.AmountCents;
        if (allocations.Count > 0 || request?.GeneralAdjustmentAmountCents is not null)
        {
            var allocatedTotal = allocations.Sum(item => item.AmountCents);
            requestedAmountCents = allocatedTotal + generalAdjustmentAmountCents;
            if (requestedAmountCents <= 0)
            {
                return BadRequest(new { message = "Select at least one item or enter a general adjustment." });
            }

            if (request?.AmountCents is not null && request.AmountCents != requestedAmountCents)
            {
                return BadRequest(new { message = "Refund total does not match the item allocation." });
            }
        }

        var result = await _orderRefundProcessor.RefundAsync(
            order,
            User.FindFirstValue(ClaimTypes.NameIdentifier),
            reason,
            "admin-direct",
            cancellationToken,
            requestedAmountCents: requestedAmountCents,
            itemAllocations: allocations);
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
                    .ThenInclude(refund => refund.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
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

        // An order nobody is making must stop being payable. Left alone, the hosted Checkout page
        // stayed chargeable until Stripe's own hourly timeout, so the two systems disagreed about
        // whether money could be taken — and the side that decides is Stripe's.
        if (nextStatus is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            await _checkoutSessionExpiry.ExpireOpenSessionsAsync(
                order,
                action.ToString(),
                cancellationToken);
        }

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

        // The refund runs after the transition is saved, deliberately. The rejection is a decision
        // staff have made and is true whether or not Stripe co-operates; rolling it back on a
        // refund failure would leave the kitchen holding an order it has already turned away.
        var refundOutcome = await RefundTurnedAwayOrderAsync(
            order,
            nextStatus,
            request.SkipRefund,
            cancellationToken);

        await _orderRealtimeNotifier.OrderUpdatedAsync(order, cancellationToken);

        var response = MapToAdminResponse(order);

        // Surfaced rather than logged. A refund that silently failed is worse than one that never
        // started: staff believe the customer has their money back and stop looking.
        if (refundOutcome is not null)
        {
            return Ok(new
            {
                order = response,
                refund = refundOutcome,
            });
        }

        return Ok(response);
    }

    /// <summary>
    /// Gives back what a customer paid for an order the restaurant has turned away.
    /// </summary>
    /// <returns>
    /// A description of the failure for staff to act on, or null when there was nothing to refund
    /// or the refund succeeded.
    /// </returns>
    private async Task<object?> RefundTurnedAwayOrderAsync(
        Order order,
        OrderStatus closedAs,
        bool skipRefund,
        CancellationToken cancellationToken)
    {
        if (closedAs is not (OrderStatus.Cancelled or OrderStatus.Rejected))
        {
            return null;
        }

        var owed = TurnedAwayOrderRefund.AmountOwedCents(order, closedByCustomer: false);

        if (owed is null)
        {
            return null;
        }

        if (skipRefund)
        {
            // On the audit record rather than in a log line: keeping a customer's money is the kind
            // of decision someone will later need to account for.
            _reportLogWriter.AddAudit(
                "Order.TurnedAwayWithoutRefund",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"{order.OrderNumber}: {owed.Value} cents kept, by request.",
                before: new { amountOwedCents = owed.Value },
                after: new { refunded = false });
            await _dbContext.SaveChangesAsync(cancellationToken);
            return null;
        }

        var result = await _orderRefundProcessor.RefundAsync(
            order,
            requestedByUserId: User.FindFirstValue(ClaimTypes.NameIdentifier),
            reason: $"Order {closedAs.ToString().ToLowerInvariant()} by the restaurant.",
            source: "order-turned-away",
            cancellationToken,
            idempotencyKeySeed: $"turned-away:{order.Id}",
            requestedAmountCents: owed.Value,
            customerExplanation: TurnedAwayOrderRefund.CustomerExplanation(closedAs));

        if (result.IsSuccess)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            return null;
        }

        _reportLogWriter.AddAudit(
            "Order.TurnedAwayRefundFailed",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"{order.OrderNumber}: refund of {owed.Value} cents failed — {result.Message}",
            before: new { amountOwedCents = owed.Value },
            after: new { refunded = false, message = result.Message });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return new
        {
            failed = true,
            amountCents = owed.Value,
            message = result.Message,
            detail = result.Detail,
        };
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

    /// <summary>
    /// The refund the customer is waiting on an answer to, for the screen the order is worked on.
    /// </summary>
    /// <remarks>
    /// Requests were only ever shown on the payments screen, so a kitchen could be preparing an
    /// order the customer had already asked to have refunded while the order screen showed nothing.
    /// </remarks>
    private static AdminOrderPendingRefundRequest? BuildPendingRefundRequest(
        Infrastructure.Orders.Order order,
        Payment? latestPayment)
    {
        var pending = order.RefundRequests
            .Where(request => request.Status is PaymentRefundRequestStatus.Pending
                or PaymentRefundRequestStatus.Processing)
            .OrderByDescending(request => request.CreatedAt)
            .ThenByDescending(request => request.Id)
            .FirstOrDefault();

        if (pending is null)
        {
            return null;
        }

        var paidCents = latestPayment?.AmountCents ?? 0;
        var alreadyRefunded = latestPayment is null ? 0 : GetSucceededRefundedAmount(latestPayment);

        return new AdminOrderPendingRefundRequest
        {
            Id = pending.Id,
            RequestedAmountCents = pending.RequestedAmountCents,
            Currency = string.IsNullOrWhiteSpace(order.Restaurant?.Currency) ? "AUD" : order.Restaurant!.Currency,
            Reason = pending.Reason,
            CreatedAt = pending.CreatedAt,
            // Answered before the click rather than explained after it.
            FullRefundWouldCancelOrder = RefundedOrderClosure.ClosureFor(
                order.Status,
                paidCents,
                alreadyRefunded + pending.RequestedAmountCents) is not null,
        };
    }

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
        var attributedRefundAmounts = RefundRequestItemPolicy.BuildAttributedRefundAmounts(order);

        return new AdminOrderResponse
        {
            Id = order.Id,
            PendingRefundRequest = BuildPendingRefundRequest(order, latestPayment),
            RestaurantId = order.RestaurantId,
            RestaurantName = order.Restaurant?.Name,
            RestaurantLegalBusinessName = order.Restaurant?.LegalBusinessName,
            RestaurantAbn = order.Restaurant?.Abn,
            RestaurantGstRegistered = order.Restaurant?.GstRegistered ?? false,
            RestaurantPricesIncludeGst = order.Restaurant?.PricesIncludeGst ?? false,
            RestaurantAddress = order.Restaurant?.Address,
            RestaurantPhone = order.Restaurant?.Phone,
            RestaurantRefundContactEmail = order.Restaurant?.RefundContactEmail,
            RestaurantCustomerSurchargeNotice = order.Restaurant?.CustomerSurchargeNotice,
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
                    StripeAccountId = latestPayment.StripeAccountId,
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
                    BasePriceSnapshot = item.BasePriceSnapshot,
                    AllergensSnapshot = item.AllergensSnapshot,
                    MayContainAllergensSnapshot = item.MayContainAllergensSnapshot,
                    CrossContactStatementSnapshot = item.CrossContactStatementSnapshot,
                    UnitPrice = item.UnitPrice,
                    TotalPrice = PricingCalculator.CalculateLineTotal(item.Quantity, item.UnitPrice),
                    RefundedAmountCents = attributedRefundAmounts.GetValueOrDefault(item.Id),
                    RefundableAmountCents = Math.Max(
                        0,
                        (long)Math.Round(
                            PricingCalculator.CalculateLineTotal(item.Quantity, item.UnitPrice) * 100m,
                            MidpointRounding.AwayFromZero)
                        - attributedRefundAmounts.GetValueOrDefault(item.Id)),
                    RefundedQuantity = RefundRequestItemPolicy.GetRefundedQuantity(
                        attributedRefundAmounts.GetValueOrDefault(item.Id),
                        (long)Math.Round(item.UnitPrice * 100m, MidpointRounding.AwayFromZero),
                        item.Quantity),
                    RefundableQuantity = Math.Max(
                        0,
                        item.Quantity - RefundRequestItemPolicy.GetRefundedQuantity(
                            attributedRefundAmounts.GetValueOrDefault(item.Id),
                            (long)Math.Round(item.UnitPrice * 100m, MidpointRounding.AwayFromZero),
                            item.Quantity)),
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
                            AllergensSnapshot = option.AllergensSnapshot,
                            MayContainAllergensSnapshot = option.MayContainAllergensSnapshot,
                            CrossContactStatementSnapshot = option.CrossContactStatementSnapshot,
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
