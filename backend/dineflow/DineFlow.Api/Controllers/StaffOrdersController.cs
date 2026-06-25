using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Extensions;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/staff/orders")]
[Authorize(Policy = AuthorizationPolicies.RestaurantStaffApi)]
public sealed class StaffOrdersController(
    AppDbContext dbContext,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResponse<AdminOrderResponse>>> GetRestaurantOrders(
        [FromQuery] AdminOrderListRequest request,
        CancellationToken cancellationToken)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = string.IsNullOrWhiteSpace(userId)
            ? null
            : await userManager.FindByIdAsync(userId);

        if (user?.RestaurantId is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Current user is not assigned to a restaurant."
            });
        }

        var query = dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order => order.RestaurantId == user.RestaurantId);

        if (!string.IsNullOrWhiteSpace(request.Status))
        {
            if (!Enum.TryParse<Infrastructure.Orders.OrderStatus>(request.Status, true, out var status) ||
                !Enum.IsDefined(status))
            {
                return BadRequest(new { message = "Unsupported order status." });
            }

            query = query.Where(order => order.Status == status);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(order =>
                EF.Functions.ILike(order.OrderNumber, pattern) ||
                (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern)) ||
                order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern)));
        }

        var sortBy = string.IsNullOrWhiteSpace(request.SortBy) ? "createdAt" : request.SortBy.Trim();
        var sortedQuery = sortBy.ToLowerInvariant() switch
        {
            "createdat" => request.IsDescending
                ? query.OrderByDescending(order => order.CreatedAt).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.CreatedAt).ThenBy(order => order.Id),
            "updatedat" => request.IsDescending
                ? query.OrderByDescending(order => order.UpdatedAt).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.UpdatedAt).ThenBy(order => order.Id),
            "ordernumber" => request.IsDescending
                ? query.OrderByDescending(order => order.OrderNumber).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.OrderNumber).ThenBy(order => order.Id),
            "status" => request.IsDescending
                ? query.OrderByDescending(order => order.Status).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.Status).ThenBy(order => order.Id),
            "paymentstatus" => request.IsDescending
                ? query.OrderByDescending(order => order.PaymentStatus).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.PaymentStatus).ThenBy(order => order.Id),
            "totalamount" => request.IsDescending
                ? query.OrderByDescending(order => order.TotalAmount).ThenByDescending(order => order.Id)
                : query.OrderBy(order => order.TotalAmount).ThenBy(order => order.Id),
            _ => null
        };

        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "createdAt", "updatedAt", "orderNumber", "status", "paymentStatus", "totalAmount" }
            });
        }

        var page = await sortedQuery
            .AsSplitQuery()
            .ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        return Ok(new PagedResponse<AdminOrderResponse>
        {
            Items = page.Items.Select(AdminOrdersController.MapToAdminResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems
        });
    }
}
