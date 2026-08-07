using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrderController : ControllerBase
{
    private const int MaximumGuestOrderLookupCount = 50;
    private readonly AppDbContext _dbContext;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly OrderPickupNumberService _orderPickupNumberService;
    private readonly MenuItemStockService _menuItemStockService;
    private readonly OrderAutoAcceptanceService _orderAutoAcceptanceService;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly TableSessionService _tableSessionService;
    private readonly ILogger<OrderController> _logger;

    public OrderController(
        AppDbContext dbContext,
        OrderRealtimeNotifier orderRealtimeNotifier,
        OrderPickupNumberService orderPickupNumberService,
        MenuItemStockService menuItemStockService,
        OrderAutoAcceptanceService orderAutoAcceptanceService,
        ReportLogWriter reportLogWriter,
        TableSessionService tableSessionService,
        ILogger<OrderController> logger)
    {
        _dbContext = dbContext;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _orderPickupNumberService = orderPickupNumberService;
        _menuItemStockService = menuItemStockService;
        _orderAutoAcceptanceService = orderAutoAcceptanceService;
        _reportLogWriter = reportLogWriter;
        _tableSessionService = tableSessionService;
        _logger = logger;
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpGet]
    public async Task<IActionResult> GetOrders(CancellationToken cancellationToken)
    {
        var orders = await _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.Items)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.PaymentRefund)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .ToListAsync(cancellationToken);

        return Ok(orders.Select(MapToResponse).ToList());
    }

    [Authorize]
    [HttpGet("mine")]
    public async Task<IActionResult> GetMyOrders(CancellationToken cancellationToken)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new { message = "Invalid token." });
        }

        var orders = await _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.Items)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.PaymentRefund)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order => order.CustomerId == currentUserId)
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.Id)
            .ToListAsync(cancellationToken);

        var menuImageUrls = await LoadMenuImageUrlsAsync(orders, cancellationToken);

        return Ok(orders.Select(order => MapToResponse(order, menuImageUrls)).ToList());
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.GuestOrderAccess)]
    [HttpPost("guest")]
    public async Task<IActionResult> GetGuestOrders(
        [FromBody] GuestOrderLookupRequest request,
        CancellationToken cancellationToken)
    {
        // Accept both shapes so clients that stored bare ids before guest tokens existed keep working.
        var requestedOrders = (request?.Orders ?? [])
            .Where(entry => entry.OrderId != Guid.Empty)
            .Select(entry => (entry.OrderId, entry.GuestAccessToken))
            .Concat((request?.OrderIds ?? [])
                .Where(orderId => orderId != Guid.Empty)
                .Select(orderId => (OrderId: orderId, GuestAccessToken: (string?)null)))
            .GroupBy(entry => entry.OrderId)
            // Prefer the entry that carries a token when both shapes name the same order.
            .Select(group => group.FirstOrDefault(entry => entry.GuestAccessToken is not null, group.First()))
            .Take(MaximumGuestOrderLookupCount)
            .ToList();

        if (requestedOrders.Count == 0)
        {
            return Ok(Array.Empty<OrderResponse>());
        }

        var tokensByOrderId = requestedOrders.ToDictionary(
            entry => entry.OrderId,
            entry => entry.GuestAccessToken);
        var orderIds = requestedOrders.Select(entry => entry.OrderId).ToList();

        var orders = await _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.Items)
            .Include(order => order.RefundRequests)
                .ThenInclude(request => request.PaymentRefund)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            // An order belonging to a signed-in customer must never be readable through the guest
            // channel — that account has /mine, and this endpoint takes no credentials at all.
            .Where(order => orderIds.Contains(order.Id) && order.CustomerId == null)
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.Id)
            .ToListAsync(cancellationToken);

        var authorizedOrders = orders
            .Where(order => GuestAccessTokenService.IsAuthorized(
                order.GuestAccessTokenHash,
                tokensByOrderId.GetValueOrDefault(order.Id)))
            .ToList();

        var menuImageUrls = await LoadMenuImageUrlsAsync(authorizedOrders, cancellationToken);

        return Ok(authorizedOrders.Select(order => MapToResponse(order, menuImageUrls)).ToList());
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetOrder(Guid id, CancellationToken cancellationToken)
    {
        var order = await _dbContext.Orders
            .AsNoTracking()
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.RefundRequests)
                .ThenInclude(request => request.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(request => request.PaymentRefund)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        return Ok(MapToResponse(order));
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.GuestOrderAccess)]
    [HttpPost("{id:guid}/cancel")]
    public async Task<ActionResult<OrderResponse>> CancelCustomerOrder(
        Guid id,
        [FromBody] CancelCustomerOrderRequest? request,
        CancellationToken cancellationToken)
    {
        var reason = TrimOrNull(request?.Reason);
        if (reason?.Length > 1_000)
        {
            return BadRequest(new { message = "Reason cannot exceed 1000 characters." });
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.PaymentRefund)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!string.IsNullOrWhiteSpace(order.CustomerId))
        {
            if (!string.Equals(order.CustomerId, currentUserId, StringComparison.Ordinal))
            {
                return Forbid();
            }
        }
        else if (!GuestAccessTokenService.IsAuthorized(order.GuestAccessTokenHash, request?.GuestAccessToken))
        {
            return Forbid();
        }

        if (!CustomerOrderCancellationPolicy.CanCancel(order.Status, order.PaymentStatus))
        {
            return Conflict(new
            {
                message = order.Status != OrderStatus.Pending
                    ? "Only pending orders can be cancelled by the customer."
                    : "This order has an active or completed payment. Use the refund request instead.",
                orderStatus = order.Status.ToString(),
                paymentStatus = order.PaymentStatus.ToString()
            });
        }

        if (order.Payments.Any(payment => payment.Status == PaymentStatus.Pending))
        {
            return Conflict(new
            {
                message = "A payment attempt is still active. Wait for it to expire before cancelling."
            });
        }

        var now = DateTime.UtcNow;
        var cancellationReason = reason ?? "Cancelled by customer.";
        var previousStatus = order.Status;
        var previousPaymentStatus = order.PaymentStatus;
        order.Status = OrderStatus.Cancelled;
        order.PaymentStatus = PaymentStatus.Cancelled;
        order.UpdatedAt = now;

        foreach (var payment in order.Payments.Where(payment =>
                     payment.Status is PaymentStatus.Unpaid
                         or PaymentStatus.Failed
                         or PaymentStatus.Expired
                         or PaymentStatus.Cancelled
                         or PaymentStatus.NotRequired))
        {
            payment.Status = PaymentStatus.Cancelled;
            payment.UpdatedAt = now;
        }

        await _menuItemStockService.ReleaseAsync(
            BuildRequestedQuantities(order.OrderItems),
            cancellationToken);

        _dbContext.OrderStatusHistories.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PreviousStatus = previousStatus,
            NewStatus = OrderStatus.Cancelled,
            Action = "CustomerCancel",
            Reason = cancellationReason,
            ChangedByUserId = currentUserId,
            CreatedAt = now
        });
        _reportLogWriter.AddAudit(
            "Order.CustomerCancelled",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Customer cancelled {order.OrderNumber}.",
            before: new
            {
                status = previousStatus.ToString(),
                paymentStatus = previousPaymentStatus.ToString()
            },
            after: new
            {
                status = OrderStatus.Cancelled.ToString(),
                paymentStatus = PaymentStatus.Cancelled.ToString(),
                reason = cancellationReason
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "order.customer_cancelled",
            $"Customer cancelled {order.OrderNumber}.",
            new
            {
                previousStatus = previousStatus.ToString(),
                status = OrderStatus.Cancelled.ToString(),
                paymentStatus = PaymentStatus.Cancelled.ToString(),
                reason = cancellationReason
            });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderUpdatedAsync(order, cancellationToken);

        return Ok(MapToResponse(order));
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.GuestOrderAccess)]
    [HttpPost("{id:guid}/refund-requests")]
    public async Task<ActionResult<CustomerRefundRequestResponse>> CreateRefundRequest(
        Guid id,
        [FromBody] CreateRefundRequestRequest? request,
        CancellationToken cancellationToken)
    {
        var reason = TrimOrNull(request?.Reason);
        if (reason?.Length > 1_000)
        {
            return BadRequest(new { message = "Reason cannot exceed 1000 characters." });
        }

        var requesterName = TrimOrNull(request?.CustomerName);
        if (requesterName?.Length > 200)
        {
            return BadRequest(new { message = "Customer name cannot exceed 200 characters." });
        }

        var requesterEmail = TrimOrNull(request?.CustomerEmail);
        if (requesterEmail?.Length > 256)
        {
            return BadRequest(new { message = "Customer email cannot exceed 256 characters." });
        }

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var order = await _dbContext.Orders
            .Include(item => item.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.Items)
            .Include(item => item.RefundRequests)
                .ThenInclude(refundRequest => refundRequest.PaymentRefund)
            .Include(item => item.Customer)
            .Include(item => item.OrderItems)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (!string.IsNullOrWhiteSpace(order.CustomerId))
        {
            if (!string.Equals(order.CustomerId, currentUserId, StringComparison.Ordinal))
            {
                return Forbid();
            }
        }
        // Nobody is signed in behind a guest order, so the token is the only thing proving the
        // caller placed it. Without this the order id alone would authorise a refund request.
        else if (!GuestAccessTokenService.IsAuthorized(order.GuestAccessTokenHash, request?.GuestAccessToken))
        {
            return Forbid();
        }

        var selectedItems = request?.Items ?? [];
        if (!RefundRequestItemPolicy.HasAtLeastOneItem(selectedItems))
        {
            return BadRequest(new { message = "Select at least one item to refund." });
        }

        if (selectedItems.Select(item => item.OrderItemId).Distinct().Count() != selectedItems.Count)
        {
            return BadRequest(new { message = "Each order item can only be selected once." });
        }

        var orderItemsById = order.OrderItems.ToDictionary(item => item.Id);
        var alreadyRefundedAmounts = BuildAttributedRefundAmounts(order);
        foreach (var selectedItem in selectedItems)
        {
            if (!orderItemsById.TryGetValue(selectedItem.OrderItemId, out var orderItem))
            {
                return BadRequest(new { message = "One of the selected items does not belong to this order." });
            }

            var lineAmountCents = PricingCalculator.ToMinorCurrencyUnits(orderItem.UnitPrice * orderItem.Quantity);
            var unitPriceCents = PricingCalculator.ToMinorCurrencyUnits(orderItem.UnitPrice);
            var alreadyRefundedAmountCents = Math.Min(
                lineAmountCents,
                alreadyRefundedAmounts.GetValueOrDefault(orderItem.Id));
            var remainingLineAmountCents = lineAmountCents - alreadyRefundedAmountCents;
            var refundedQuantity = RefundRequestItemPolicy.GetRefundedQuantity(
                alreadyRefundedAmountCents,
                unitPriceCents,
                orderItem.Quantity);
            var remainingQuantity = orderItem.Quantity
                - refundedQuantity;
            if (remainingLineAmountCents <= 0 || remainingQuantity <= 0)
            {
                return BadRequest(new
                {
                    message = $"\"{orderItem.MenuItemNameSnapshot}\" has already been refunded."
                });
            }

            if (!RefundRequestItemPolicy.IsValidQuantity(selectedItem.Quantity, remainingQuantity))
            {
                return BadRequest(new
                {
                    message = $"Quantity for \"{orderItem.MenuItemNameSnapshot}\" must be between 1 and {remainingQuantity}."
                });
            }

            var requestedItemAmountCents = selectedItem.AmountCents
                ?? PricingCalculator.ToMinorCurrencyUnits(orderItem.UnitPrice * selectedItem.Quantity);
            var selectedQuantityAmountCents = PricingCalculator.ToMinorCurrencyUnits(
                orderItem.UnitPrice * selectedItem.Quantity);
            if (!RefundRequestItemPolicy.IsValidAmount(
                    requestedItemAmountCents,
                    selectedQuantityAmountCents,
                    remainingLineAmountCents))
            {
                return BadRequest(new
                {
                    message = $"Refund amount for \"{orderItem.MenuItemNameSnapshot}\" must be between 1 and "
                        + $"{Math.Min(selectedQuantityAmountCents, remainingLineAmountCents)} cents."
                });
            }
        }

        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return Conflict(new { message = "Only online payments can be requested for refund here." });
        }

        if (order.PaymentStatus is not (PaymentStatus.Paid or PaymentStatus.PartiallyRefunded))
        {
            return Conflict(new
            {
                message = "Only paid online orders can be requested for refund.",
                paymentStatus = order.PaymentStatus.ToString()
            });
        }

        if (order.RefundRequests.Any(item =>
                item.Status is PaymentRefundRequestStatus.Pending or PaymentRefundRequestStatus.Processing))
        {
            return Conflict(new { message = "A refund request is already waiting for review." });
        }

        var payment = FindRefundablePayment(order);

        if (payment is null)
        {
            return Conflict(new { message = "No refundable Stripe payment was found for this order." });
        }

        if (payment.ProviderPaymentIntentId!.StartsWith("pi_demo_", StringComparison.OrdinalIgnoreCase))
        {
            return Conflict(new { message = "Demo payments cannot be requested for live Stripe refund." });
        }

        if (payment.Refunds.Any(refund => refund.Status == PaymentRefundStatus.Pending))
        {
            return Conflict(new { message = "A refund is already pending for this payment." });
        }

        var refundedAmountCents = GetSucceededRefundedAmount(payment);
        var refundableAmountCents = payment.AmountCents - refundedAmountCents;
        if (refundableAmountCents <= 0)
        {
            return Conflict(new { message = "This payment has already been fully refunded." });
        }

        var refundRequestItems = selectedItems
            .Select(selectedItem =>
            {
                var orderItem = orderItemsById[selectedItem.OrderItemId];
                return new PaymentRefundRequestItem
                {
                    Id = Guid.NewGuid(),
                    OrderItemId = orderItem.Id,
                    MenuItemNameSnapshot = orderItem.MenuItemNameSnapshot,
                    Quantity = selectedItem.Quantity,
                    AmountCents = selectedItem.AmountCents
                        ?? PricingCalculator.ToMinorCurrencyUnits(orderItem.UnitPrice * selectedItem.Quantity)
                };
            })
            .ToList();

        var requestedAmountCents = refundRequestItems.Sum(item => item.AmountCents);
        if (requestedAmountCents <= 0 || requestedAmountCents > refundableAmountCents)
        {
            return Conflict(new { message = "The selected items are no longer available to refund." });
        }

        var now = DateTime.UtcNow;
        var refundRequest = new PaymentRefundRequest
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PaymentId = payment.Id,
            RestaurantId = order.RestaurantId,
            Status = PaymentRefundRequestStatus.Pending,
            RequestedAmountCents = requestedAmountCents,
            Currency = payment.Currency,
            Reason = reason,
            RequestedByUserId = currentUserId,
            RequesterName = requesterName ?? order.Customer?.FullName,
            RequesterEmail = requesterEmail ?? order.Customer?.Email,
            CreatedAt = now,
            Items = refundRequestItems
        };

        _dbContext.PaymentRefundRequests.Add(refundRequest);
        _reportLogWriter.AddAudit(
            "RefundRequest.Created",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Refund request submitted for {order.OrderNumber}.",
            after: new
            {
                refundRequestId = refundRequest.Id,
                orderId = order.Id,
                order.OrderNumber,
                paymentId = payment.Id,
                refundRequest.RequestedAmountCents,
                refundRequest.Currency,
                reason
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "refund_request.created",
            $"Refund request submitted for {order.OrderNumber}.",
            new
            {
                refundRequestId = refundRequest.Id,
                paymentId = payment.Id,
                refundRequest.RequestedAmountCents,
                refundRequest.Currency,
                reason
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(MapToCustomerRefundRequestResponse(refundRequest));
    }

    [HttpPost]
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    public async Task<IActionResult> CreateOrder(
        [FromBody] CreateOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Order data is required." });
        }

        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "restaurantId is required." });
        }

        if (request.Items is null || request.Items.Count == 0)
        {
            return BadRequest(new { message = "Order must contain at least one item." });
        }

        if (!Enum.TryParse<PaymentMethod>(request.PaymentMethod, true, out var paymentMethod) ||
            !Enum.IsDefined(paymentMethod))
        {
            return BadRequest(new { message = "Invalid payment method." });
        }

        var buildResult = await BuildOrderItemsAsync(request, cancellationToken);

        if (buildResult.ValidationErrors.Count > 0)
        {
            return BadRequest(new { message = "Order validation failed.", errors = buildResult.ValidationErrors });
        }

        var now = DateTime.UtcNow;
        var orderNumber = string.IsNullOrWhiteSpace(request.OrderNumber)
            ? GenerateOrderNumber()
            : request.OrderNumber.Trim();

        var restaurant = await _dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(
                item => item.Id == request.RestaurantId && item.IsActive,
                cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant is not available." });
        }

        TableSession? tableSession = null;
        if (request.TableId.HasValue)
        {
            var tableIsActive = await _dbContext.RestaurantTables
                .AsNoTracking()
                .AnyAsync(
                    table =>
                        table.Id == request.TableId.Value &&
                        table.RestaurantId == request.RestaurantId &&
                        table.IsActive,
                    cancellationToken);

            if (!tableIsActive)
            {
                return Conflict(new { message = "Table is not available for this restaurant." });
            }

            tableSession = await _tableSessionService.GetOrCreateOpenSessionAsync(
                request.RestaurantId,
                request.TableId.Value,
                now,
                cancellationToken);
        }

        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            TableId = request.TableId,
            TableSessionId = tableSession?.Id,
            CustomerId = request.CustomerId,
            OrderNumber = orderNumber,
            OrderType = (OrderType)request.OrderType,
            Status = OrderStatus.Pending,
            PaymentStatus = PaymentStatus.Unpaid,
            PaymentMethod = paymentMethod,
            TotalAmount = PricingCalculator.CalculateTotal(buildResult.OrderItems.Select(item => (item.Quantity, item.UnitPrice))),
            CustomerNote = request.CustomerNote,
            ScheduledTime = request.ScheduledTime,
            CreatedAt = now
        };

        // The reservation must commit with the order, so both live in one transaction. It also
        // covers the pickup-number allocation below.
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var unavailableItemIds = await _menuItemStockService.TryReserveAsync(
            BuildRequestedQuantities(buildResult.OrderItems),
            cancellationToken);

        if (unavailableItemIds.Count > 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Conflict(new
            {
                message = "Some items sold out while the order was being placed.",
                items = DescribeUnavailableItems(unavailableItemIds, buildResult.OrderItems)
            });
        }

        await _orderPickupNumberService.AssignPickupNumberAsync(order, restaurant, now, cancellationToken);

        foreach (var orderItem in buildResult.OrderItems)
        {
            orderItem.OrderId = order.Id;
            order.OrderItems.Add(orderItem);
        }

        await _orderAutoAcceptanceService.TryAcceptAsync(order, cancellationToken);
        await _dbContext.Orders.AddAsync(order, cancellationToken);
        _reportLogWriter.AddAudit(
            "Order.Created",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Order {order.OrderNumber} created.",
            after: new
            {
                order.Id,
                order.OrderNumber,
                order.RestaurantId,
                order.TableId,
                order.CustomerId,
                order.OrderType,
                order.Status,
                order.PaymentStatus,
                order.PaymentMethod,
                order.TotalAmount
            });
        _reportLogWriter.AddOrderEvent(
            order,
            "order.created",
            $"Order {order.OrderNumber} created.",
            new
            {
                order.OrderType,
                order.Status,
                order.PaymentStatus,
                order.PaymentMethod,
                order.TotalAmount
            });
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        await _dbContext.Entry(order).Reference(item => item.Restaurant).LoadAsync(cancellationToken);

        if (order.TableId.HasValue)
        {
            await _dbContext.Entry(order).Reference(item => item.Table).LoadAsync(cancellationToken);
        }

        _logger.LogInformation("Order {OrderNumber} created for restaurant {RestaurantId}", orderNumber, request.RestaurantId);
        await _orderRealtimeNotifier.OrderCreatedAsync(order, cancellationToken);

        return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, MapToResponse(order));
    }

    /// <summary>
    /// Totals per menu item, since the same item can appear on several order lines. Lines whose
    /// menu item has since been deleted carry no id and cannot be stock-tracked, so they are
    /// skipped.
    /// </summary>
    internal static Dictionary<Guid, int> BuildRequestedQuantities(IEnumerable<OrderItem> orderItems)
    {
        var quantities = new Dictionary<Guid, int>();

        foreach (var orderItem in orderItems)
        {
            if (orderItem.MenuItemId is not { } menuItemId)
            {
                continue;
            }

            quantities[menuItemId] = quantities.GetValueOrDefault(menuItemId) + orderItem.Quantity;
        }

        return quantities;
    }

    internal static IReadOnlyList<string> DescribeUnavailableItems(
        IReadOnlyList<Guid> menuItemIds,
        IEnumerable<OrderItem> orderItems) =>
        menuItemIds
            .Select(id => orderItems.FirstOrDefault(item => item.MenuItemId == id)?.MenuItemNameSnapshot ?? "Unknown item")
            .Distinct()
            .ToList();

    [HttpPut("{id:guid}")]
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    public async Task<IActionResult> UpdateOrder(
        Guid id,
        [FromBody] CreateOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Order data is required." });
        }

        if (!Enum.IsDefined(typeof(OrderStatus), request.Status))
        {
            return BadRequest(new { message = "Invalid order status." });
        }

        if (!Enum.TryParse<PaymentMethod>(request.PaymentMethod, true, out var paymentMethod) ||
            !Enum.IsDefined(paymentMethod))
        {
            return BadRequest(new { message = "Invalid payment method." });
        }

        var existingOrder = await _dbContext.Orders
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Table)
            .FirstOrDefaultAsync(order => order.Id == id, cancellationToken);

        if (existingOrder is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if ((OrderStatus)request.Status != existingOrder.Status)
        {
            return Conflict(new { message = "Use the admin order transition API to change order status." });
        }

        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "restaurantId is required." });
        }

        if (request.Items is null || request.Items.Count == 0)
        {
            return BadRequest(new { message = "Order must contain at least one item." });
        }

        var buildResult = await BuildOrderItemsAsync(request, cancellationToken);

        if (buildResult.ValidationErrors.Count > 0)
        {
            return BadRequest(new { message = "Order validation failed.", errors = buildResult.ValidationErrors });
        }

        _dbContext.OrderItems.RemoveRange(existingOrder.OrderItems);
        existingOrder.OrderItems.Clear();

        existingOrder.RestaurantId = request.RestaurantId;
        existingOrder.TableId = request.TableId;
        existingOrder.CustomerId = request.CustomerId;
        existingOrder.OrderNumber = string.IsNullOrWhiteSpace(request.OrderNumber)
            ? existingOrder.OrderNumber
            : request.OrderNumber.Trim();
        existingOrder.OrderType = (OrderType)request.OrderType;
        existingOrder.PaymentMethod = paymentMethod;
        existingOrder.TotalAmount = PricingCalculator.CalculateTotal(buildResult.OrderItems.Select(item => (item.Quantity, item.UnitPrice)));
        existingOrder.CustomerNote = request.CustomerNote;
        existingOrder.ScheduledTime = request.ScheduledTime;
        existingOrder.TicketRevision += 1;
        existingOrder.UpdatedAt = DateTime.UtcNow;

        foreach (var orderItem in buildResult.OrderItems)
        {
            orderItem.OrderId = existingOrder.Id;
            existingOrder.OrderItems.Add(orderItem);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderUpdatedAsync(existingOrder, cancellationToken);

        return NoContent();
    }

    [HttpPut("{id:guid}/status")]
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    public async Task<IActionResult> UpdateStatus(
        Guid id,
        [FromBody] UpdateOrderStatusRequest request,
        CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(typeof(OrderStatus), request.NewStatus))
        {
            return BadRequest(new { message = "Invalid order status." });
        }

        var order = await _dbContext.Orders.FindAsync(new object?[] { id }, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        var nextStatus = (OrderStatus)request.NewStatus;
        var history = new OrderStatusHistory
        {
            OrderId = order.Id,
            PreviousStatus = order.Status,
            NewStatus = nextStatus,
            Action = "StatusChanged",
            ChangedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            CreatedAt = DateTime.UtcNow
        };

        order.Status = nextStatus;
        order.UpdatedAt = DateTime.UtcNow;

        _dbContext.OrderStatusHistories.Add(history);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderUpdatedAsync(order, cancellationToken);

        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    public async Task<IActionResult> DeleteOrder(Guid id, CancellationToken cancellationToken)
    {
        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        _dbContext.OrderItems.RemoveRange(order.OrderItems);
        _dbContext.Orders.Remove(order);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderDeletedAsync(order, cancellationToken);

        return NoContent();
    }

    private async Task<OrderItemBuildResult> BuildOrderItemsAsync(
        CreateOrderRequest request,
        CancellationToken cancellationToken)
    {
        var orderItems = new List<OrderItem>();
        var validationErrors = new List<string>();
        var menuItemIds = request.Items.Select(item => item.MenuItemId).Distinct().ToList();

        var menuItems = await _dbContext.MenuItems
            .Include(item => item.OptionGroups.Where(group => group.IsActive))
                .ThenInclude(group => group.Options.Where(option => option.IsAvailable))
            .Where(item => menuItemIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        foreach (var itemRequest in request.Items)
        {
            if (itemRequest.Quantity <= 0)
            {
                validationErrors.Add($"Quantity must be positive for item {itemRequest.MenuItemId}.");
                continue;
            }

            if (!menuItems.TryGetValue(itemRequest.MenuItemId, out var menuItem))
            {
                validationErrors.Add($"Menu item {itemRequest.MenuItemId} not found.");
                continue;
            }

            if (menuItem.RestaurantId != request.RestaurantId)
            {
                validationErrors.Add($"Menu item {itemRequest.MenuItemId} does not belong to this restaurant.");
                continue;
            }

            if (!menuItem.IsAvailable)
            {
                validationErrors.Add($"'{menuItem.Name}' is not available.");
                continue;
            }

            if (menuItem.IsSoldOut)
            {
                validationErrors.Add($"'{menuItem.Name}' is sold out.");
                continue;
            }

            var allOptions = menuItem.OptionGroups
                .SelectMany(group => group.Options)
                .ToDictionary(option => option.Id);

            var selectedOptionCounts = (itemRequest.SelectedOptionIds ?? [])
                .Where(optionId => optionId != Guid.Empty)
                .GroupBy(optionId => optionId)
                .ToDictionary(group => group.Key, group => group.Count());
            var selectedOptions = new List<SelectedMenuOption>();

            foreach (var optionId in selectedOptionCounts.Keys)
            {
                if (!allOptions.TryGetValue(optionId, out var option))
                {
                    validationErrors.Add($"Option {optionId} is not valid for '{menuItem.Name}'.");
                    continue;
                }

                selectedOptions.Add(new SelectedMenuOption(option, selectedOptionCounts[optionId]));
            }

            foreach (var selection in selectedOptions)
            {
                if (selection.Quantity > selection.Option.MaxQuantity)
                {
                    validationErrors.Add($"'{selection.Option.Name}' allows at most {selection.Option.MaxQuantity} per item.");
                }
            }

            foreach (var group in menuItem.OptionGroups)
            {
                var selectedInGroup = selectedOptions
                    .Where(selection => selection.Option.GroupId == group.Id)
                    .Sum(selection => selection.Quantity);

                if (group.IsRequired && selectedInGroup < group.MinSelections)
                {
                    validationErrors.Add($"'{group.Name}' requires at least {group.MinSelections} selection(s) for '{menuItem.Name}'.");
                }

                if (selectedInGroup > group.MaxSelections)
                {
                    validationErrors.Add($"'{group.Name}' allows at most {group.MaxSelections} selection(s) for '{menuItem.Name}'.");
                }
            }

            if (validationErrors.Count > 0)
            {
                continue;
            }

            var unitPrice = PricingCalculator.CalculateUnitPrice(
                menuItem.Price,
                selectedOptions.Select(selection => new MenuOptionPriceSelection(selection.Option, selection.Quantity)));

            var orderItem = new OrderItem
            {
                Id = Guid.NewGuid(),
                MenuItemId = menuItem.Id,
                MenuItemNameSnapshot = menuItem.Name,
                BasePriceSnapshot = menuItem.Price,
                Quantity = itemRequest.Quantity,
                UnitPrice = unitPrice,
                ItemInstructions = itemRequest.ItemInstructions,
                AllergyInfo = itemRequest.AllergyInfo,
                CreatedAt = DateTime.UtcNow
            };

            foreach (var selection in selectedOptions)
            {
                var option = selection.Option;
                var groupName = menuItem.OptionGroups
                    .First(group => group.Id == option.GroupId)
                    .Name;

                orderItem.SelectedOptions.Add(new OrderItemOption
                {
                    MenuItemOptionId = option.Id,
                    GroupNameSnapshot = groupName,
                    OptionNameSnapshot = option.Name,
                    PriceAdjustmentSnapshot = option.PriceAdjustment,
                    Quantity = selection.Quantity,
                    CreatedAt = DateTime.UtcNow
                });
            }

            orderItems.Add(orderItem);
        }

        return new OrderItemBuildResult(orderItems, validationErrors);
    }

    private static OrderResponse MapToResponse(Order order) => MapToResponse(order, null);

    private static OrderResponse MapToResponse(
        Order order,
        IReadOnlyDictionary<Guid, string?>? menuImageUrls) => MapToResponse(
            order,
            menuImageUrls,
            BuildAttributedRefundAmounts(order));

    private static OrderResponse MapToResponse(
        Order order,
        IReadOnlyDictionary<Guid, string?>? menuImageUrls,
        IReadOnlyDictionary<Guid, long> refundedAmounts) => new()
    {
        Id = order.Id,
        RestaurantId = order.RestaurantId,
        TableId = order.TableId,
        TableNumber = order.Table?.TableNumber,
        CustomerId = order.CustomerId,
        OrderNumber = order.OrderNumber,
        PickupDate = order.PickupDate,
        PickupNumber = order.PickupNumber,
        PickupCode = OrderPickupNumberService.FormatPickupCode(order.PickupNumber),
        Currency = string.IsNullOrWhiteSpace(order.Restaurant?.Currency) ? "AUD" : order.Restaurant.Currency,
        OrderType = (int)order.OrderType,
        Status = (int)order.Status,
        PaymentStatus = order.PaymentStatus.ToString(),
        PaymentMethod = order.PaymentMethod.ToString(),
        TotalAmount = order.TotalAmount,
        CustomerNote = order.CustomerNote,
        ScheduledTime = order.ScheduledTime,
        CreatedAt = order.CreatedAt,
        UpdatedAt = order.UpdatedAt,
        RefundBalance = BuildRefundBalance(order),
        LatestRefundRequest = order.RefundRequests
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .Select(MapToCustomerRefundRequestResponse)
            .FirstOrDefault(),
        OrderItems = order.OrderItems
            .OrderBy(item => item.CreatedAt)
            .ThenBy(item => item.Id)
            .Select(item => new OrderItemResponse
            {
                Id = item.Id,
                OrderId = item.OrderId,
                MenuItemId = item.MenuItemId,
                MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                ItemNameSnapshot = item.MenuItemNameSnapshot,
                BasePriceSnapshot = item.BasePriceSnapshot,
                ImageUrl = item.MenuItemId is Guid menuItemId
                    && menuImageUrls is not null
                    && menuImageUrls.TryGetValue(menuItemId, out var imageUrl)
                        ? imageUrl
                        : null,
                Quantity = item.Quantity,
                RefundedQuantity = RefundRequestItemPolicy.GetRefundedQuantity(
                    refundedAmounts.GetValueOrDefault(item.Id),
                    PricingCalculator.ToMinorCurrencyUnits(item.UnitPrice),
                    item.Quantity),
                RefundedAmountCents = Math.Min(
                    PricingCalculator.ToMinorCurrencyUnits(item.UnitPrice * item.Quantity),
                    refundedAmounts.GetValueOrDefault(item.Id)),
                RefundableAmountCents = Math.Max(
                    0,
                    PricingCalculator.ToMinorCurrencyUnits(item.UnitPrice * item.Quantity)
                        - refundedAmounts.GetValueOrDefault(item.Id)),
                UnitPrice = item.UnitPrice,
                ItemInstructions = item.ItemInstructions,
                Note = item.ItemInstructions,
                AllergyInfo = item.AllergyInfo,
                CreatedAt = item.CreatedAt,
                UpdatedAt = item.UpdatedAt,
                SelectedOptions = item.SelectedOptions
                    .OrderBy(option => option.CreatedAt)
                    .ThenBy(option => option.Id)
                    .Select(option => new OrderItemOptionResponse
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

    private static CustomerRefundRequestResponse MapToCustomerRefundRequestResponse(PaymentRefundRequest request) =>
        new()
        {
            Id = request.Id,
            OrderId = request.OrderId,
            Status = request.Status.ToString(),
            RequestedAmountCents = request.RequestedAmountCents,
            RefundedAmountCents = request.PaymentRefund?.AmountCents,
            RefundStatus = request.PaymentRefund?.Status.ToString(),
            Currency = request.Currency,
            Reason = request.Reason,
            AdminNote = request.AdminNote,
            CreatedAt = request.CreatedAt,
            UpdatedAt = request.UpdatedAt,
            ReviewedAt = request.ReviewedAt,
            Items = request.Items
                .Select(item => new CustomerRefundRequestItemResponse
                {
                    MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                    Quantity = item.Quantity,
                    AmountCents = item.AmountCents
                })
                .ToList()
        };

    // Menu images are not snapshotted on OrderItem, so resolve them from the live menu for
    // presentation only. Deleted menu items simply fall back to no image.
    private async Task<Dictionary<Guid, string?>> LoadMenuImageUrlsAsync(
        IEnumerable<Order> orders,
        CancellationToken cancellationToken)
    {
        var menuItemIds = orders
            .SelectMany(order => order.OrderItems)
            .Select(item => item.MenuItemId)
            .OfType<Guid>()
            .Distinct()
            .ToList();

        if (menuItemIds.Count == 0)
        {
            return [];
        }

        return await _dbContext.MenuItems
            .AsNoTracking()
            .Where(item => menuItemIds.Contains(item.Id))
            .Select(item => new { item.Id, item.ImageUrl })
            .ToDictionaryAsync(item => item.Id, item => item.ImageUrl, cancellationToken);
    }

    // Single source of truth for "which payment can this order be refunded against", shared by
    // the refund-request endpoint and the balance shown to the customer, so they never disagree.
    private static Payment? FindRefundablePayment(Order order) =>
        order.Payments
            .Where(item =>
                item.Provider == PaymentProviders.Stripe &&
                item.Status is PaymentStatus.Paid or PaymentStatus.PartiallyRefunded &&
                !string.IsNullOrWhiteSpace(item.ProviderPaymentIntentId))
            .OrderByDescending(item => item.PaidAt ?? item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .FirstOrDefault();

    // Exact itemised requests are attributable as entered. A staff-adjusted refund is also
    // unambiguous when the request contains only one item, so apply the actual approved amount to
    // that line. We deliberately do not guess how to split an adjusted total across several items.
    private static Dictionary<Guid, long> BuildAttributedRefundAmounts(Order order)
    {
        var amounts = new Dictionary<Guid, long>();

        foreach (var allocation in EnumerateAttributedRefundAllocations(order))
        {
            amounts[allocation.OrderItemId] = amounts.GetValueOrDefault(allocation.OrderItemId)
                + allocation.AmountCents;
        }

        return amounts;
    }

    private static IEnumerable<(Guid OrderItemId, long AmountCents)> EnumerateAttributedRefundAllocations(
        Order order)
    {
        var seenRefundIds = new HashSet<Guid>();

        foreach (var request in order.RefundRequests)
        {
            var refund = request.PaymentRefund;
            if (refund is null
                || refund.Status != PaymentRefundStatus.Succeeded
                || request.Items.Count == 0
                || !seenRefundIds.Add(refund.Id))
            {
                continue;
            }

            var allocations = RefundRequestItemPolicy.AttributeSucceededRefund(
                refund.AmountCents,
                request.Items
                    .Select(item => (item.OrderItemId, item.AmountCents))
                    .ToList());
            foreach (var allocation in allocations)
            {
                yield return allocation;
            }
        }
    }

    private static OrderRefundBalance BuildRefundBalance(Order order)
    {
        var payment = FindRefundablePayment(order);
        if (payment is null)
        {
            return new OrderRefundBalance();
        }

        var refunded = GetSucceededRefundedAmount(payment);
        var attributed = EnumerateAttributedRefundAllocations(order)
            .Sum(allocation => allocation.AmountCents);

        return new OrderRefundBalance
        {
            AlreadyRefundedAmountCents = refunded,
            RefundableAmountCents = Math.Max(0, payment.AmountCents - refunded),
            UnattributedRefundedAmountCents = Math.Max(0, refunded - attributed)
        };
    }

    private static long GetSucceededRefundedAmount(Payment payment) =>
        payment.Refunds
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Sum(refund => refund.AmountCents);

    private static string? TrimOrNull(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Trim();
    }

    private static string GenerateOrderNumber() =>
        $"ORD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N")[..6].ToUpper()}";

    private sealed record OrderItemBuildResult(
        List<OrderItem> OrderItems,
        List<string> ValidationErrors);

    private sealed record SelectedMenuOption(MenuItemOption Option, int Quantity);
}
