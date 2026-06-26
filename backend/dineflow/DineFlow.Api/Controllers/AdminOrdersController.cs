using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Order;
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

    public AdminOrdersController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        OrderRealtimeNotifier orderRealtimeNotifier)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _orderRealtimeNotifier = orderRealtimeNotifier;
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
                order.PaymentStatus != PaymentStatus.Paid &&
                order.Status != OrderStatus.Cancelled &&
                order.Status != OrderStatus.Rejected);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern) ||
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
    public async Task<ActionResult<AdminOrderSummaryResponse>> GetOrderSummary(CancellationToken cancellationToken)
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
                    order.PaymentStatus != PaymentStatus.Paid &&
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

        if (order.PaymentStatus == PaymentStatus.Paid)
        {
            return Ok(MapToAdminResponse(order));
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return Conflict(new { message = "Cancelled or rejected orders cannot be settled." });
        }

        var now = DateTime.UtcNow;
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

        await _dbContext.SaveChangesAsync(cancellationToken);
        await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);
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

    internal static AdminOrderResponse MapToAdminResponse(Infrastructure.Orders.Order order)
    {
        var latestPayment = order.Payments
            .OrderByDescending(payment => payment.CreatedAt)
            .ThenByDescending(payment => payment.Id)
            .FirstOrDefault();
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
                    FailureReason = latestPayment.FailureReason,
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
        order.PaymentStatus == PaymentStatus.Paid || order.PaymentMethod == PaymentMethod.PayAtCounter;

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
