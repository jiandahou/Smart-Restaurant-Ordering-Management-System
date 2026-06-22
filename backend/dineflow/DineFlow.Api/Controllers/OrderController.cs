using DineFlow.Api.Contracts.Order;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OrderController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<OrderController> _logger;

    public OrderController(AppDbContext dbContext, ILogger<OrderController> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetOrders()
    {
        var orders = await _dbContext.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.SelectedOptions)
            .ToListAsync();

        return Ok(orders.Select(MapToResponse));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetOrder(Guid id)
    {
        var order = await _dbContext.Orders
            .Include(o => o.OrderItems)
                .ThenInclude(oi => oi.SelectedOptions)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (order is null)
            return NotFound(new { message = "Order not found." });

        return Ok(MapToResponse(order));
    }

    [HttpPost]
    public async Task<IActionResult> CreateOrder([FromBody] CreateOrderRequest request)
    {
        if (request is null)
            return BadRequest(new { message = "Order data is required." });

        if (request.RestaurantId == Guid.Empty)
            return BadRequest(new { message = "restaurantId is required." });

        if (request.Items is null || request.Items.Count == 0)
            return BadRequest(new { message = "Order must contain at least one item." });

        // Load all requested menu items with their active option groups/options in one query
        var menuItemIds = request.Items.Select(i => i.MenuItemId).Distinct().ToList();

        var menuItems = await _dbContext.MenuItems
            .Include(m => m.OptionGroups.Where(g => g.IsActive))
                .ThenInclude(g => g.Options.Where(o => o.IsAvailable))
            .Where(m => menuItemIds.Contains(m.Id))
            .ToDictionaryAsync(m => m.Id);

        var orderItems = new List<OrderItem>();
        var validationErrors = new List<string>();

        foreach (var itemReq in request.Items)
        {
            if (itemReq.Quantity <= 0)
            {
                validationErrors.Add($"Quantity must be positive for item {itemReq.MenuItemId}.");
                continue;
            }

            if (!menuItems.TryGetValue(itemReq.MenuItemId, out var menuItem))
            {
                validationErrors.Add($"Menu item {itemReq.MenuItemId} not found.");
                continue;
            }

            // Cross-restaurant check — never trust client-submitted IDs across tenants
            if (menuItem.RestaurantId != request.RestaurantId)
            {
                validationErrors.Add($"Menu item {itemReq.MenuItemId} does not belong to this restaurant.");
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

            // Build a flat lookup of all available options for this item
            var allOptions = menuItem.OptionGroups
                .SelectMany(g => g.Options)
                .ToDictionary(o => o.Id);

            var selectedOptionIds = itemReq.SelectedOptionIds ?? [];
            var selectedOptions = new List<MenuItemOption>();

            foreach (var optionId in selectedOptionIds)
            {
                if (!allOptions.TryGetValue(optionId, out var opt))
                {
                    validationErrors.Add($"Option {optionId} is not valid for '{menuItem.Name}'.");
                    continue;
                }
                selectedOptions.Add(opt);
            }

            // Validate required groups and min/max selections per group
            foreach (var group in menuItem.OptionGroups)
            {
                var selectedInGroup = selectedOptions.Count(o => o.GroupId == group.Id);

                if (group.IsRequired && selectedInGroup < group.MinSelections)
                    validationErrors.Add($"'{group.Name}' requires at least {group.MinSelections} selection(s) for '{menuItem.Name}'.");

                if (selectedInGroup > group.MaxSelections)
                    validationErrors.Add($"'{group.Name}' allows at most {group.MaxSelections} selection(s) for '{menuItem.Name}'.");
            }

            if (validationErrors.Count > 0) continue;

            // Server-side pricing — never use client-submitted prices
            decimal unitPrice = menuItem.Price;

            foreach (var opt in selectedOptions)
            {
                unitPrice = opt.AdjustmentType switch
                {
                    OptionAdjustmentType.Add => unitPrice + opt.PriceAdjustment,
                    OptionAdjustmentType.Remove => unitPrice + opt.PriceAdjustment, // PriceAdjustment is <= 0
                    OptionAdjustmentType.Replace => opt.PriceAdjustment,
                    _ => unitPrice
                };
            }

            var orderItem = new OrderItem
            {
                Id = Guid.NewGuid(),
                MenuItemId = menuItem.Id,
                MenuItemNameSnapshot = menuItem.Name,
                BasePriceSnapshot = menuItem.Price,
                Quantity = itemReq.Quantity,
                UnitPrice = unitPrice,
                ItemInstructions = itemReq.ItemInstructions,
                AllergyInfo = itemReq.AllergyInfo,
                CreatedAt = DateTime.UtcNow
            };

            foreach (var opt in selectedOptions)
            {
                orderItem.SelectedOptions.Add(new OrderItemOption
                {
                    MenuItemOptionId = opt.Id,
                    GroupNameSnapshot = opt.Group!.Name,
                    OptionNameSnapshot = opt.Name,
                    PriceAdjustmentSnapshot = opt.PriceAdjustment,
                    CreatedAt = DateTime.UtcNow
                });
            }

            orderItems.Add(orderItem);
        }

        if (validationErrors.Count > 0)
            return BadRequest(new { message = "Order validation failed.", errors = validationErrors });

        var totalAmount = orderItems.Sum(oi => oi.Quantity * oi.UnitPrice);
        var orderNumber = $"ORD-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid().ToString("N")[..6].ToUpper()}";

        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            TableId = request.TableId,
            OrderNumber = orderNumber,
            OrderType = (OrderType)request.OrderType,
            Status = OrderStatus.Pending,
            TotalAmount = totalAmount,
            CustomerNote = request.CustomerNote,
            ScheduledTime = request.ScheduledTime,
            CreatedAt = DateTime.UtcNow
        };

        foreach (var oi in orderItems)
        {
            foreach (var itemRequest in request.OrderItems)
            {
                order.OrderItems.Add(new OrderItem
                {
                    Id = Guid.NewGuid(),
                    MenuItemId = itemRequest.MenuItemId,
                    ItemNameSnapshot = itemRequest.ItemNameSnapshot ?? string.Empty,
                    Quantity = itemRequest.Quantity,
                    UnitPrice = itemRequest.UnitPrice,
                    Note = itemRequest.Note,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        await _dbContext.Orders.AddAsync(order);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Order {OrderNumber} created for restaurant {RestaurantId}", orderNumber, request.RestaurantId);

        return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, MapToResponse(order));
    }

    [HttpPut("{id:guid}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateOrderStatusRequest request)
    {
        var order = await _dbContext.Orders.FindAsync(id);
        if (order is null)
            return NotFound(new { message = "Order not found." });

        var history = new OrderStatusHistory
        {
            OrderId = order.Id,
            PreviousStatus = order.Status,
            NewStatus = (OrderStatus)request.NewStatus,
            ChangedByUserId = User.FindFirst("sub")?.Value,
            CreatedAt = DateTime.UtcNow
        };

            foreach (var itemRequest in request.OrderItems)
            {
                existingOrder.OrderItems.Add(new OrderItem
                {
                    Id = Guid.NewGuid(),
                    MenuItemId = itemRequest.MenuItemId,
                    ItemNameSnapshot = itemRequest.ItemNameSnapshot ?? string.Empty,
                    Quantity = itemRequest.Quantity,
                    UnitPrice = itemRequest.UnitPrice,
                    Note = itemRequest.Note,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        _dbContext.OrderStatusHistories.Add(history);
        await _dbContext.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteOrder(Guid id)
    {
        var order = await _dbContext.Orders
            .Include(o => o.OrderItems)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (order is null)
            return NotFound(new { message = "Order not found." });

        _dbContext.OrderItems.RemoveRange(order.OrderItems);
        _dbContext.Orders.Remove(order);
        await _dbContext.SaveChangesAsync();
        return NoContent();
    }

    private static OrderResponse MapToResponse(Order order) => new()
    {
        Id = order.Id,
        RestaurantId = order.RestaurantId,
        TableId = order.TableId,
        CustomerId = order.CustomerId,
        OrderNumber = order.OrderNumber,
        OrderType = (int)order.OrderType,
        Status = (int)order.Status,
        TotalAmount = order.TotalAmount,
        CustomerNote = order.CustomerNote,
        ScheduledTime = order.ScheduledTime,
        CreatedAt = order.CreatedAt,
        UpdatedAt = order.UpdatedAt,
        OrderItems = order.OrderItems.Select(oi => new OrderItemResponse
        {
            Id = oi.Id,
            OrderId = oi.OrderId,
            MenuItemId = oi.MenuItemId,
            MenuItemNameSnapshot = oi.MenuItemNameSnapshot,
            BasePriceSnapshot = oi.BasePriceSnapshot,
            Quantity = oi.Quantity,
            UnitPrice = oi.UnitPrice,
            ItemInstructions = oi.ItemInstructions,
            AllergyInfo = oi.AllergyInfo,
            CreatedAt = oi.CreatedAt,
            UpdatedAt = oi.UpdatedAt,
            SelectedOptions = oi.SelectedOptions.Select(opt => new OrderItemOptionResponse
            {
                Id = opt.Id,
                MenuItemOptionId = opt.MenuItemOptionId,
                GroupNameSnapshot = opt.GroupNameSnapshot,
                OptionNameSnapshot = opt.OptionNameSnapshot,
                PriceAdjustmentSnapshot = opt.PriceAdjustmentSnapshot
            }).ToList()
        }).ToList()
    };
}
