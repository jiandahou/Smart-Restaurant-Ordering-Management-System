using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrderController : ControllerBase
{
    private const int MaximumGuestOrderLookupCount = 50;
    private readonly AppDbContext _dbContext;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly ILogger<OrderController> _logger;

    public OrderController(
        AppDbContext dbContext,
        OrderRealtimeNotifier orderRealtimeNotifier,
        ILogger<OrderController> logger)
    {
        _dbContext = dbContext;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetOrders(CancellationToken cancellationToken)
    {
        var orders = await _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
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
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order => order.CustomerId == currentUserId)
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.Id)
            .ToListAsync(cancellationToken);

        return Ok(orders.Select(MapToResponse).ToList());
    }

    [AllowAnonymous]
    [HttpPost("guest")]
    public async Task<IActionResult> GetGuestOrders(
        [FromBody] GuestOrderLookupRequest request,
        CancellationToken cancellationToken)
    {
        if (request?.OrderIds is null || request.OrderIds.Count == 0)
        {
            return Ok(Array.Empty<OrderResponse>());
        }

        var orderIds = request.OrderIds
            .Where(orderId => orderId != Guid.Empty)
            .Distinct()
            .Take(MaximumGuestOrderLookupCount)
            .ToList();

        var orders = await _dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order => orderIds.Contains(order.Id))
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.Id)
            .ToListAsync(cancellationToken);

        return Ok(orders.Select(MapToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetOrder(Guid id, CancellationToken cancellationToken)
    {
        var order = await _dbContext.Orders
            .AsNoTracking()
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        return Ok(MapToResponse(order));
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

        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            TableId = request.TableId,
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

        foreach (var orderItem in buildResult.OrderItems)
        {
            orderItem.OrderId = order.Id;
            order.OrderItems.Add(orderItem);
        }

        await _dbContext.Orders.AddAsync(order, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await _dbContext.Entry(order).Reference(item => item.Restaurant).LoadAsync(cancellationToken);

        if (order.TableId.HasValue)
        {
            await _dbContext.Entry(order).Reference(item => item.Table).LoadAsync(cancellationToken);
        }

        _logger.LogInformation("Order {OrderNumber} created for restaurant {RestaurantId}", orderNumber, request.RestaurantId);
        await _orderRealtimeNotifier.OrderCreatedAsync(order, cancellationToken);

        return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, MapToResponse(order));
    }

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

    private static OrderResponse MapToResponse(Order order) => new()
    {
        Id = order.Id,
        RestaurantId = order.RestaurantId,
        TableId = order.TableId,
        TableNumber = order.Table?.TableNumber,
        CustomerId = order.CustomerId,
        OrderNumber = order.OrderNumber,
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
                Quantity = item.Quantity,
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

    private static string GenerateOrderNumber() =>
        $"ORD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N")[..6].ToUpper()}";

    private sealed record OrderItemBuildResult(
        List<OrderItem> OrderItems,
        List<string> ValidationErrors);

    private sealed record SelectedMenuOption(MenuItemOption Option, int Quantity);
}
