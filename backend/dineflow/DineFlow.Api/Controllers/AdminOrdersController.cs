using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Order;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/admin/orders")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class AdminOrdersController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;

    public AdminOrdersController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager)
    {
        _dbContext = dbContext;
        _userManager = userManager;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AdminOrderResponse>>> GetOrders(CancellationToken cancellationToken)
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
            .Include(order => order.Payments)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .AsQueryable();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            query = query.Where(order => order.RestaurantId == currentRestaurantId);
        }

        var orders = await query
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.OrderNumber)
            .ToListAsync(cancellationToken);

        return Ok(orders.Select(MapToAdminResponse).ToList());
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

    private static AdminOrderResponse MapToAdminResponse(Infrastructure.Orders.Order order)
    {
        var latestPayment = order.Payments
            .OrderByDescending(payment => payment.CreatedAt)
            .ThenByDescending(payment => payment.Id)
            .FirstOrDefault();

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
            Items = order.OrderItems
                .OrderBy(item => item.CreatedAt)
                .ThenBy(item => item.Id)
                .Select(item => new AdminOrderItemResponse
                {
                    Id = item.Id,
                    MenuItemId = item.MenuItemId,
                    ItemNameSnapshot = item.ItemNameSnapshot,
                    Quantity = item.Quantity,
                    UnitPrice = item.UnitPrice,
                    TotalPrice = item.Quantity * item.UnitPrice,
                    Note = item.Note
                })
                .ToList()
        };
    }
}
