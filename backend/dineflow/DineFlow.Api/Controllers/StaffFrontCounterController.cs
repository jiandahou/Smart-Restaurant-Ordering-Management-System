using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/staff/front-counter")]
[Authorize(Policy = AuthorizationPolicies.StaffApi)]
public sealed class StaffFrontCounterController(
    AppDbContext dbContext,
    UserManager<ApplicationUser> userManager,
    OrderRealtimeNotifier orderRealtimeNotifier,
    ReportLogWriter reportLogWriter) : ControllerBase
{
    private static readonly OrderStatus[] ActiveOrderStatuses =
    [
        OrderStatus.Pending,
        OrderStatus.Accepted,
        OrderStatus.Preparing,
        OrderStatus.Ready
    ];

    [HttpGet("takeaway")]
    public async Task<ActionResult<FrontCounterTakeawayResponse>> GetTakeawayOrders(
        [FromQuery] FrontCounterListRequest request,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(request.RestaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        var restaurantId = scope.RestaurantId!.Value;
        var query = dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order =>
                order.RestaurantId == restaurantId &&
                order.OrderType == OrderType.Takeaway &&
                ActiveOrderStatuses.Contains(order.Status));

        query = ApplyOrderSearch(query, request.Search);

        var orders = await query
            .OrderBy(order => order.PickupNumber ?? int.MaxValue)
            .ThenBy(order => order.CreatedAt)
            .ThenBy(order => order.Id)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return Ok(new FrontCounterTakeawayResponse
        {
            GeneratedAt = DateTime.UtcNow,
            Orders = orders.Select(AdminOrdersController.MapToAdminResponse).ToList()
        });
    }

    [HttpGet("table-sessions")]
    public async Task<ActionResult<FrontCounterTableSessionsResponse>> GetTableSessions(
        [FromQuery] FrontCounterListRequest request,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(request.RestaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        var sessions = await LoadOpenTableSessions(scope.RestaurantId!.Value)
            .AsNoTracking()
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        var mapped = sessions
            .Select(MapTableSessionSummary)
            .Where(session => MatchesSessionSearch(session, request.Search))
            .OrderByDescending(session => session.ActiveOrderCount > 0)
            .ThenBy(session => session.TableNumber)
            .ToList();

        return Ok(new FrontCounterTableSessionsResponse
        {
            GeneratedAt = DateTime.UtcNow,
            Sessions = mapped
        });
    }

    [HttpGet("tables")]
    public async Task<ActionResult<FrontCounterTablesResponse>> GetTables(
        [FromQuery] FrontCounterListRequest request,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(request.RestaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == scope.RestaurantId!.Value && item.IsActive, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var tables = await dbContext.RestaurantTables
            .AsNoTracking()
            .Where(table => table.RestaurantId == restaurant.Id && table.IsActive)
            .OrderBy(table => table.TableNumber)
            .ToListAsync(cancellationToken);

        var openSessions = await LoadOpenTableSessions(restaurant.Id)
            .AsNoTracking()
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        var sessionsByTable = openSessions.ToDictionary(session => session.TableId);
        var historyCounts = await dbContext.Orders
            .AsNoTracking()
            .Where(order =>
                order.RestaurantId == restaurant.Id &&
                order.TableId.HasValue &&
                !ActiveOrderStatuses.Contains(order.Status))
            .GroupBy(order => order.TableId!.Value)
            .Select(group => new
            {
                TableId = group.Key,
                Count = group.Count()
            })
            .ToDictionaryAsync(item => item.TableId, item => item.Count, cancellationToken);

        var mapped = tables
            .Select(table =>
                MapTableSummary(
                    table,
                    restaurant,
                    sessionsByTable.GetValueOrDefault(table.Id),
                    historyCounts.GetValueOrDefault(table.Id)))
            .Where(table => MatchesTableSearch(table, request.Search))
            .OrderByDescending(table => table.ActiveOrderCount > 0)
            .ThenBy(table => table.TableNumber)
            .ToList();

        return Ok(new FrontCounterTablesResponse
        {
            GeneratedAt = DateTime.UtcNow,
            Tables = mapped
        });
    }

    [HttpGet("tables/{tableId:guid}")]
    public async Task<ActionResult<FrontCounterTableDetailResponse>> GetTable(
        Guid tableId,
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(restaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == scope.RestaurantId!.Value && item.IsActive, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var table = await dbContext.RestaurantTables
            .AsNoTracking()
            .FirstOrDefaultAsync(
                item =>
                    item.Id == tableId &&
                    item.RestaurantId == restaurant.Id &&
                    item.IsActive,
                cancellationToken);

        if (table is null)
        {
            return NotFound(new { message = "Table not found." });
        }

        var openSession = await LoadOpenTableSessions(restaurant.Id)
            .AsNoTracking()
            .AsSplitQuery()
            .FirstOrDefaultAsync(item => item.TableId == table.Id, cancellationToken);

        var historyOrders = await LoadTableOrderQuery(restaurant.Id, table.Id)
            .AsNoTracking()
            .Where(order => !ActiveOrderStatuses.Contains(order.Status))
            .OrderByDescending(order => order.CreatedAt)
            .ThenByDescending(order => order.Id)
            .Take(30)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        return Ok(MapTableDetail(table, restaurant, openSession, historyOrders));
    }

    [HttpGet("table-sessions/{sessionId:guid}")]
    public async Task<ActionResult<FrontCounterTableSessionDetailResponse>> GetTableSession(
        Guid sessionId,
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(restaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        var session = await LoadOpenTableSessions(scope.RestaurantId!.Value)
            .AsNoTracking()
            .AsSplitQuery()
            .FirstOrDefaultAsync(item => item.Id == sessionId, cancellationToken);

        if (session is null)
        {
            return NotFound(new { message = "Table session not found." });
        }

        return Ok(MapTableSessionDetail(session));
    }

    [HttpPost("orders/{orderId:guid}/settle-complete")]
    public async Task<ActionResult<FrontCounterSettleOrderResponse>> SettleCompleteOrder(
        Guid orderId,
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(restaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var order = await LoadTrackedOrderQuery(scope.RestaurantId!.Value)
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        var result = SettleAndCompleteOrder(order, DateTime.UtcNow);
        if (result.Error is not null)
        {
            return result.Error;
        }

        await CloseTableSessionIfCompleteAsync(order.TableSessionId, order.Id, DateTime.UtcNow, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        if (result.PaymentChanged)
        {
            await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);
        }

        if (result.StatusChanged)
        {
            await orderRealtimeNotifier.OrderUpdatedAsync(order, cancellationToken);
        }

        return Ok(new FrontCounterSettleOrderResponse
        {
            Order = AdminOrdersController.MapToAdminResponse(order)
        });
    }

    [HttpPost("table-sessions/{sessionId:guid}/settle-complete")]
    public async Task<ActionResult<FrontCounterSettleTableSessionResponse>> SettleCompleteTableSession(
        Guid sessionId,
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var scope = await ResolveRestaurantIdAsync(restaurantId, cancellationToken);
        if (scope.Error is not null)
        {
            return scope.Error;
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var session = await LoadOpenTableSessions(scope.RestaurantId!.Value)
            .FirstOrDefaultAsync(item => item.Id == sessionId, cancellationToken);

        if (session is null)
        {
            return NotFound(new { message = "Table session not found." });
        }

        var changedOrders = new List<(Order Order, bool PaymentChanged, bool StatusChanged)>();
        var activeOrders = session.Orders
            .Where(TableSessionService.IsActiveOrder)
            .OrderBy(order => order.CreatedAt)
            .ThenBy(order => order.Id)
            .ToList();

        foreach (var order in activeOrders)
        {
            var result = SettleAndCompleteOrder(order, DateTime.UtcNow);
            if (result.Error is not null)
            {
                return result.Error;
            }

            changedOrders.Add((order, result.PaymentChanged, result.StatusChanged));
        }

        if (session.Status == TableSessionStatus.Open &&
            session.Orders.All(order => !TableSessionService.IsActiveOrder(order)))
        {
            var now = DateTime.UtcNow;
            session.Status = TableSessionStatus.Closed;
            session.ClosedAt = now;
            session.UpdatedAt = now;
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        foreach (var changedOrder in changedOrders)
        {
            if (changedOrder.PaymentChanged)
            {
                await orderRealtimeNotifier.OrderPaymentUpdatedAsync(changedOrder.Order, cancellationToken);
            }

            if (changedOrder.StatusChanged)
            {
                await orderRealtimeNotifier.OrderUpdatedAsync(changedOrder.Order, cancellationToken);
            }
        }

        return Ok(new FrontCounterSettleTableSessionResponse
        {
            TableSession = MapTableSessionDetail(session)
        });
    }

    private IQueryable<TableSession> LoadOpenTableSessions(Guid restaurantId) =>
        dbContext.TableSessions
            .Include(session => session.Restaurant)
            .Include(session => session.Table)
            .Include(session => session.Orders)
                .ThenInclude(order => order.OrderItems)
                    .ThenInclude(item => item.SelectedOptions)
            .Include(session => session.Orders)
                .ThenInclude(order => order.Payments)
                    .ThenInclude(payment => payment.Refunds)
            .Include(session => session.Orders)
                .ThenInclude(order => order.Customer)
            .Include(session => session.Orders)
                .ThenInclude(order => order.Restaurant)
            .Include(session => session.Orders)
                .ThenInclude(order => order.Table)
            .Where(session =>
                session.RestaurantId == restaurantId &&
                session.Status == TableSessionStatus.Open);

    private IQueryable<Order> LoadTrackedOrderQuery(Guid restaurantId) =>
        dbContext.Orders
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order => order.RestaurantId == restaurantId);

    private IQueryable<Order> LoadTableOrderQuery(Guid restaurantId, Guid tableId) =>
        dbContext.Orders
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Payments)
                .ThenInclude(payment => payment.Refunds)
            .Include(order => order.Customer)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .Where(order =>
                order.RestaurantId == restaurantId &&
                order.TableId == tableId);

    private (bool PaymentChanged, bool StatusChanged, ActionResult? Error) SettleAndCompleteOrder(
        Order order,
        DateTime now)
    {
        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return (false, false, Conflict(new
            {
                message = "Cancelled or rejected orders cannot be settled at the front counter."
            }));
        }

        var paymentChanged = false;
        if (order.PaymentStatus != PaymentStatus.Paid)
        {
            if (order.PaymentMethod != PaymentMethod.PayAtCounter)
            {
                return (false, false, Conflict(new
                {
                    message = "Online orders must be paid online before the front counter can complete them.",
                    paymentStatus = order.PaymentStatus.ToString(),
                    paymentMethod = order.PaymentMethod.ToString()
                }));
            }

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
            dbContext.Payments.Add(counterPayment);
            paymentChanged = true;

            reportLogWriter.AddAudit(
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
            reportLogWriter.AddOrderEvent(
                order,
                "payment.counter_recorded",
                $"Counter payment recorded for {order.OrderNumber}.",
                new
                {
                    paymentId = counterPayment.Id,
                    counterPayment.AmountCents,
                    counterPayment.Currency
                });
            reportLogWriter.AddPaymentEvent(
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
        }

        if (order.Status == OrderStatus.Completed)
        {
            return (paymentChanged, false, null);
        }

        var previousStatus = order.Status;
        order.Status = OrderStatus.Completed;
        order.UpdatedAt = now;
        dbContext.OrderStatusHistories.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PreviousStatus = previousStatus,
            NewStatus = OrderStatus.Completed,
            Action = OrderTransitionAction.Complete.ToString(),
            ChangedByUserId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            CreatedAt = now
        });
        reportLogWriter.AddAudit(
            "Order.StatusChanged",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"{order.OrderNumber}: {previousStatus} -> {OrderStatus.Completed}.",
            before: new
            {
                status = previousStatus.ToString()
            },
            after: new
            {
                status = OrderStatus.Completed.ToString(),
                action = OrderTransitionAction.Complete.ToString()
            });
        reportLogWriter.AddOrderEvent(
            order,
            "order.status_changed",
            $"{order.OrderNumber}: {previousStatus} -> {OrderStatus.Completed}.",
            new
            {
                previousStatus = previousStatus.ToString(),
                nextStatus = OrderStatus.Completed.ToString(),
                action = OrderTransitionAction.Complete.ToString()
            });

        return (paymentChanged, true, null);
    }

    private async Task CloseTableSessionIfCompleteAsync(
        Guid? sessionId,
        Guid completedOrderId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (!sessionId.HasValue)
        {
            return;
        }

        var hasActiveOrders = await dbContext.Orders
            .AnyAsync(
                order =>
                    order.TableSessionId == sessionId.Value &&
                    order.Id != completedOrderId &&
                    ActiveOrderStatuses.Contains(order.Status),
                cancellationToken);

        if (hasActiveOrders)
        {
            return;
        }

        var session = await dbContext.TableSessions
            .FirstOrDefaultAsync(
                item => item.Id == sessionId.Value && item.Status == TableSessionStatus.Open,
                cancellationToken);

        if (session is null)
        {
            return;
        }

        session.Status = TableSessionStatus.Closed;
        session.ClosedAt = now;
        session.UpdatedAt = now;
    }

    private static FrontCounterTableSessionSummaryResponse MapTableSessionSummary(TableSession session)
    {
        var activeOrders = session.Orders
            .Where(TableSessionService.IsActiveOrder)
            .OrderBy(order => order.CreatedAt)
            .ThenBy(order => order.Id)
            .ToList();
        var itemCount = activeOrders
            .SelectMany(order => order.OrderItems)
            .Sum(item => item.Quantity);

        return new FrontCounterTableSessionSummaryResponse
        {
            Id = session.Id,
            RestaurantId = session.RestaurantId,
            RestaurantName = session.Restaurant?.Name ?? string.Empty,
            TableId = session.TableId,
            TableNumber = session.Table?.TableNumber ?? string.Empty,
            Status = session.Status.ToString(),
            OpenedAt = session.OpenedAt,
            ClosedAt = session.ClosedAt,
            Currency = string.IsNullOrWhiteSpace(session.Restaurant?.Currency) ? "AUD" : session.Restaurant.Currency,
            ActiveOrderCount = activeOrders.Count,
            ItemCount = itemCount,
            TotalAmount = activeOrders.Sum(order => order.TotalAmount),
            AmountDue = activeOrders
                .Where(order => order.PaymentStatus != PaymentStatus.Paid)
                .Sum(order => order.TotalAmount),
            LatestOrderStatus = activeOrders
                .OrderByDescending(order => order.UpdatedAt ?? order.CreatedAt)
                .ThenByDescending(order => order.Id)
                .FirstOrDefault()
                ?.Status
                .ToString() ?? string.Empty
        };
    }

    private static FrontCounterTableSummaryResponse MapTableSummary(
        RestaurantTable table,
        DineFlow.Infrastructure.Restaurant.Restaurant restaurant,
        TableSession? session,
        int historyOrderCount)
    {
        var activeOrders = session?.Orders
            .Where(TableSessionService.IsActiveOrder)
            .OrderBy(order => order.CreatedAt)
            .ThenBy(order => order.Id)
            .ToList() ?? [];
        var itemCount = activeOrders
            .SelectMany(order => order.OrderItems)
            .Sum(item => item.Quantity);

        return new FrontCounterTableSummaryResponse
        {
            RestaurantId = restaurant.Id,
            RestaurantName = restaurant.Name,
            TableId = table.Id,
            TableNumber = table.TableNumber,
            Capacity = table.Capacity,
            IsActive = table.IsActive,
            ActiveSessionId = session?.Id,
            OpenedAt = session?.OpenedAt,
            Currency = string.IsNullOrWhiteSpace(restaurant.Currency) ? "AUD" : restaurant.Currency,
            ActiveOrderCount = activeOrders.Count,
            HistoryOrderCount = historyOrderCount,
            ItemCount = itemCount,
            TotalAmount = activeOrders.Sum(order => order.TotalAmount),
            AmountDue = activeOrders
                .Where(order => order.PaymentStatus != PaymentStatus.Paid)
                .Sum(order => order.TotalAmount),
            LatestOrderStatus = activeOrders
                .OrderByDescending(order => order.UpdatedAt ?? order.CreatedAt)
                .ThenByDescending(order => order.Id)
                .FirstOrDefault()
                ?.Status
                .ToString() ?? string.Empty,
            MergedItems = CreateMergedItems(activeOrders),
            ActiveOrders = activeOrders.Select(AdminOrdersController.MapToAdminResponse).ToList()
        };
    }

    private static FrontCounterTableDetailResponse MapTableDetail(
        RestaurantTable table,
        DineFlow.Infrastructure.Restaurant.Restaurant restaurant,
        TableSession? session,
        IReadOnlyList<Order> historyOrders)
    {
        var summary = MapTableSummary(table, restaurant, session, historyOrders.Count);

        return new FrontCounterTableDetailResponse
        {
            RestaurantId = summary.RestaurantId,
            RestaurantName = summary.RestaurantName,
            TableId = summary.TableId,
            TableNumber = summary.TableNumber,
            Capacity = summary.Capacity,
            IsActive = summary.IsActive,
            ActiveSessionId = summary.ActiveSessionId,
            OpenedAt = summary.OpenedAt,
            Currency = summary.Currency,
            ActiveOrderCount = summary.ActiveOrderCount,
            HistoryOrderCount = summary.HistoryOrderCount,
            ItemCount = summary.ItemCount,
            TotalAmount = summary.TotalAmount,
            AmountDue = summary.AmountDue,
            LatestOrderStatus = summary.LatestOrderStatus,
            MergedItems = summary.MergedItems,
            ActiveOrders = summary.ActiveOrders,
            ActiveSession = session is null ? null : MapTableSessionDetail(session),
            HistoryOrders = historyOrders.Select(AdminOrdersController.MapToAdminResponse).ToList()
        };
    }

    private static FrontCounterTableSessionDetailResponse MapTableSessionDetail(TableSession session)
    {
        var summary = MapTableSessionSummary(session);
        var activeOrders = session.Orders
            .Where(TableSessionService.IsActiveOrder)
            .OrderBy(order => order.CreatedAt)
            .ThenBy(order => order.Id)
            .ToList();

        return new FrontCounterTableSessionDetailResponse
        {
            Id = summary.Id,
            RestaurantId = summary.RestaurantId,
            RestaurantName = summary.RestaurantName,
            TableId = summary.TableId,
            TableNumber = summary.TableNumber,
            Status = summary.Status,
            OpenedAt = summary.OpenedAt,
            ClosedAt = summary.ClosedAt,
            Currency = summary.Currency,
            ActiveOrderCount = summary.ActiveOrderCount,
            ItemCount = summary.ItemCount,
            TotalAmount = summary.TotalAmount,
            AmountDue = summary.AmountDue,
            LatestOrderStatus = summary.LatestOrderStatus,
            MergedItems = CreateMergedItems(activeOrders),
            Orders = activeOrders.Select(AdminOrdersController.MapToAdminResponse).ToList()
        };
    }

    private static List<FrontCounterMergedItemResponse> CreateMergedItems(IReadOnlyList<Order> orders)
    {
        return orders
            .SelectMany(order => order.OrderItems)
            .GroupBy(item => new
            {
                Name = item.MenuItemNameSnapshot,
                item.UnitPrice,
                Note = item.ItemInstructions ?? string.Empty,
                Options = CreateOptionsKey(item)
            })
            .OrderBy(group => group.Min(item => item.CreatedAt))
            .Select(group =>
            {
                var first = group.First();
                return new FrontCounterMergedItemResponse
                {
                    ItemName = first.MenuItemNameSnapshot,
                    Quantity = group.Sum(item => item.Quantity),
                    UnitPrice = first.UnitPrice,
                    TotalPrice = group.Sum(item => PricingCalculator.CalculateLineTotal(item.Quantity, item.UnitPrice)),
                    Note = string.IsNullOrWhiteSpace(first.ItemInstructions) ? null : first.ItemInstructions,
                    SelectedOptions = first.SelectedOptions
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
                        .ToList(),
                    OrderItemIds = group.Select(item => item.Id).ToList()
                };
            })
            .ToList();
    }

    private static string CreateOptionsKey(OrderItem item) =>
        string.Join(
            "|",
            item.SelectedOptions
                .OrderBy(option => option.GroupNameSnapshot)
                .ThenBy(option => option.OptionNameSnapshot)
                .ThenBy(option => option.PriceAdjustmentSnapshot)
                .ThenBy(option => option.Quantity)
                .Select(option =>
                    $"{option.GroupNameSnapshot}:{option.OptionNameSnapshot}:{option.PriceAdjustmentSnapshot}:{option.Quantity}"));

    private static IQueryable<Order> ApplyOrderSearch(IQueryable<Order> query, string? search)
    {
        var normalized = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return query;
        }

        var pattern = $"%{normalized}%";
        var pickupSearch = normalized.TrimStart('#');
        var hasPickupNumber = int.TryParse(pickupSearch, out var pickupNumber);

        return query.Where(order =>
            EF.Functions.ILike(order.OrderNumber, pattern) ||
            (order.Table != null && EF.Functions.ILike(order.Table.TableNumber, pattern)) ||
            order.OrderItems.Any(item => EF.Functions.ILike(item.MenuItemNameSnapshot, pattern)) ||
            (hasPickupNumber && order.PickupNumber == pickupNumber));
    }

    private static bool MatchesSessionSearch(
        FrontCounterTableSessionSummaryResponse session,
        string? search)
    {
        var normalized = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return true;
        }

        return session.TableNumber.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
            session.RestaurantName.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
            session.LatestOrderStatus.Contains(normalized, StringComparison.OrdinalIgnoreCase);
    }

    private static bool MatchesTableSearch(
        FrontCounterTableSummaryResponse table,
        string? search)
    {
        var normalized = search?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return true;
        }

        return table.TableNumber.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
            table.RestaurantName.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
            table.LatestOrderStatus.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
            table.MergedItems.Any(item => item.ItemName.Contains(normalized, StringComparison.OrdinalIgnoreCase)) ||
            table.ActiveOrders.Any(order =>
                order.OrderNumber.Contains(normalized, StringComparison.OrdinalIgnoreCase) ||
                order.PickupCode.Contains(normalized, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<(Guid? RestaurantId, ActionResult? Error)> ResolveRestaurantIdAsync(
        Guid? requestedRestaurantId,
        CancellationToken cancellationToken)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            if (!requestedRestaurantId.HasValue)
            {
                return (null, BadRequest(new { message = "restaurantId is required for PlatformOwner front counter access." }));
            }

            var exists = await dbContext.Restaurants
                .AsNoTracking()
                .AnyAsync(
                    restaurant => restaurant.Id == requestedRestaurantId.Value && restaurant.IsActive,
                    cancellationToken);

            return exists
                ? (requestedRestaurantId.Value, null)
                : (null, NotFound(new { message = "Restaurant not found." }));
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var user = string.IsNullOrWhiteSpace(userId)
            ? null
            : await userManager.FindByIdAsync(userId);

        if (user?.RestaurantId is null)
        {
            return (null, StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Current user is not assigned to a restaurant."
            }));
        }

        if (requestedRestaurantId.HasValue && requestedRestaurantId.Value != user.RestaurantId.Value)
        {
            return (null, Forbid());
        }

        return (user.RestaurantId.Value, null);
    }
}
