using DineFlow.Api.Contracts.Order;
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
            .ToListAsync();

        var responses = orders.Select(MapToResponse).ToList();
        return Ok(responses);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetOrder(Guid id)
    {
        var order = await _dbContext.Orders
            .Include(o => o.OrderItems)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        return Ok(MapToResponse(order));
    }

    [HttpPost]
    public async Task<IActionResult> CreateOrder([FromBody] CreateOrderRequest request)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Order data is required." });
        }

        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            TableId = request.TableId,
            CustomerId = request.CustomerId,
            OrderNumber = request.OrderNumber,
            OrderType = (OrderType)request.OrderType,
            Status = (OrderStatus)request.Status,
            TotalAmount = request.TotalAmount,
            CustomerNote = request.CustomerNote,
            ScheduledTime = request.ScheduledTime,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = null
        };

        if (request.OrderItems is not null && request.OrderItems.Count > 0)
        {
            foreach (var itemRequest in request.OrderItems)
            {
                order.OrderItems.Add(new OrderItem
                {
                    Id = Guid.NewGuid(),
                    MenuItemId = itemRequest.MenuItemId,
                    Quantity = itemRequest.Quantity,
                    UnitPrice = itemRequest.UnitPrice,
                    Note = itemRequest.Note,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        await _dbContext.Orders.AddAsync(order);
        await _dbContext.SaveChangesAsync();

        var response = MapToResponse(order);
        return CreatedAtAction(nameof(GetOrder), new { id = order.Id }, response);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateOrder(Guid id, [FromBody] CreateOrderRequest request)
    {
        if (request is null)
        {
            return BadRequest(new { message = "Order data is required." });
        }

        var existingOrder = await _dbContext.Orders
            .Include(o => o.OrderItems)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (existingOrder is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        existingOrder.RestaurantId = request.RestaurantId;
        existingOrder.TableId = request.TableId;
        existingOrder.CustomerId = request.CustomerId;
        existingOrder.OrderNumber = request.OrderNumber;
        existingOrder.OrderType = (OrderType)request.OrderType;
        existingOrder.Status = (OrderStatus)request.Status;
        existingOrder.TotalAmount = request.TotalAmount;
        existingOrder.CustomerNote = request.CustomerNote;
        existingOrder.ScheduledTime = request.ScheduledTime;
        existingOrder.UpdatedAt = DateTime.UtcNow;

        if (request.OrderItems is not null)
        {
            _dbContext.OrderItems.RemoveRange(existingOrder.OrderItems);
            existingOrder.OrderItems.Clear();

            foreach (var itemRequest in request.OrderItems)
            {
                existingOrder.OrderItems.Add(new OrderItem
                {
                    Id = Guid.NewGuid(),
                    MenuItemId = itemRequest.MenuItemId,
                    Quantity = itemRequest.Quantity,
                    UnitPrice = itemRequest.UnitPrice,
                    Note = itemRequest.Note,
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

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
        {
            return NotFound(new { message = "Order not found." });
        }

        _dbContext.OrderItems.RemoveRange(order.OrderItems);
        _dbContext.Orders.Remove(order);
        await _dbContext.SaveChangesAsync();

        return NoContent();
    }

    private OrderResponse MapToResponse(Order order)
    {
        return new OrderResponse
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
                Quantity = oi.Quantity,
                UnitPrice = oi.UnitPrice,
                Note = oi.Note,
                CreatedAt = oi.CreatedAt,
                UpdatedAt = oi.UpdatedAt
            }).ToList()
        };
    }
}
