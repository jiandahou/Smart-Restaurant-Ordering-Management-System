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

using DineFlow.Api.Services;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/staff/orders")]
[Authorize(Policy = AuthorizationPolicies.RestaurantStaffApi)]
public sealed class StaffOrdersController(
    AppDbContext dbContext,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<StaffOrderPageResponse>> GetRestaurantOrders(
        [FromQuery] AdminOrderListRequest request,
        [FromQuery] string? queue,
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

        if (!string.IsNullOrWhiteSpace(queue) && !Infrastructure.Orders.StaffOrderQueue.IsKnown(queue))
        {
            return BadRequest(new
            {
                message = "Unsupported queue value.",
                allowedValues = Infrastructure.Orders.StaffOrderQueue.All
            });
        }

        // Filters first, without the related data. The queue counts are taken from this, and asking
        // for every order's items in order to count orders would fetch the whole restaurant's history
        // to answer a number on a tab.
        var query = dbContext.Orders
            .AsNoTracking()
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
            // Applied after the restaurant scope above, so a search can only ever reach this
            // restaurant's own orders.
            query = query.Where(StaffOrderSearch.Predicate(search));
        }

        var utcNow = DateTime.UtcNow;
        var queueCounts = await Infrastructure.Orders.StaffOrderQueue.CountAsync(query, utcNow, cancellationToken);

        if (!string.IsNullOrWhiteSpace(queue))
        {
            query = query.Where(Infrastructure.Orders.StaffOrderQueue.Predicate(queue, utcNow));
        }

        // Only now the related data, and only for the rows that will be returned.
        query = query
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            // The refunds have to come with the payments: MapToAdminResponse works out how much of
            // each line was refunded from them, and without them every line reports nothing
            // refunded — so a kitchen screen shows a dish to make that has already been paid back.
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
                    .ThenInclude(refund => refund.Items)
            .Include(order => order.RefundRequests)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table);

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

        return Ok(new StaffOrderPageResponse
        {
            Items = page.Items.Select(AdminOrdersController.MapToAdminResponse).ToList(),
            Page = page.Page,
            PageSize = page.PageSize,
            TotalItems = page.TotalItems,
            QueueCounts = queueCounts
        });
    }
}
