using System.Globalization;
using System.Text.Json;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Reports;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed class AdminActivityReportService(AppDbContext dbContext)
{
    public const int AuditRetentionDays = 2_555;
    public const int OrderEventRetentionDays = 730;
    public const int PaymentEventRetentionDays = 2_555;

    public async Task<PagedResponse<ActivityLogResponse>> GetActivityAsync(
        ActivityLogListRequest request,
        Guid? currentRestaurantId,
        bool isPlatformOwner,
        bool includeTechnicalDetails,
        CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 100);
        var fetchCount = checked(page * pageSize);
        var normalizedCategory = request.Category?.Trim().ToLowerInvariant();

        var auditQuery = BuildAuditQuery(request, currentRestaurantId, isPlatformOwner);
        var orderQuery = BuildOrderQuery(request, currentRestaurantId, isPlatformOwner);
        var paymentQuery = BuildPaymentQuery(request, currentRestaurantId, isPlatformOwner);

        var includeAudit = string.IsNullOrWhiteSpace(normalizedCategory) ||
                           normalizedCategory is "account" or "restaurant" or "menu" or "user" or "system";
        var includeOrders = string.IsNullOrWhiteSpace(normalizedCategory) ||
                            normalizedCategory is "order" or "refund";
        var includePayments = string.IsNullOrWhiteSpace(normalizedCategory) ||
                              normalizedCategory is "payment" or "refund";

        var auditCount = includeAudit ? await auditQuery.CountAsync(cancellationToken) : 0;
        var orderCount = includeOrders ? await orderQuery.CountAsync(cancellationToken) : 0;
        var paymentCount = includePayments ? await paymentQuery.CountAsync(cancellationToken) : 0;

        var auditRows = includeAudit
            ? await auditQuery
                .OrderByDescending(log => log.CreatedAt)
                .ThenByDescending(log => log.Id)
                .Take(fetchCount)
                .Select(log => new ActivityProjection
                {
                    Id = log.Id,
                    RestaurantId = log.RestaurantId,
                    OccurredAt = log.CreatedAt,
                    Category = "Audit",
                    EventType = log.Action,
                    ActorUserId = log.ActorUserId,
                    ActorName = log.ActorEmail,
                    ActorRoles = log.ActorRoles,
                    ActorType = log.ActorType,
                    Source = log.Source,
                    CorrelationId = log.CorrelationId,
                    SubjectType = log.EntityType,
                    SubjectId = log.EntityId,
                    Message = log.Summary,
                    TechnicalJson = log.AfterJson ?? log.BeforeJson
                })
                .ToListAsync(cancellationToken)
            : [];

        var orderRows = includeOrders
            ? await orderQuery
                .OrderByDescending(log => log.CreatedAt)
                .ThenByDescending(log => log.Id)
                .Take(fetchCount)
                .Select(log => new ActivityProjection
                {
                    Id = log.Id,
                    RestaurantId = log.RestaurantId,
                    OccurredAt = log.CreatedAt,
                    Category = log.EventType.StartsWith("refund_") ? "Refund" : "Order",
                    EventType = log.EventType,
                    ActorUserId = log.ActorUserId,
                    ActorName = log.ActorDisplayName,
                    ActorRoles = log.ActorRoles,
                    ActorType = log.ActorType,
                    Source = log.Source,
                    CorrelationId = log.CorrelationId,
                    SubjectType = "Order",
                    OrderId = log.OrderId,
                    OrderNumber = log.OrderNumber,
                    Message = log.Message,
                    TechnicalJson = log.DataJson
                })
                .ToListAsync(cancellationToken)
            : [];

        var paymentRows = includePayments
            ? await paymentQuery
                .OrderByDescending(log => log.CreatedAt)
                .ThenByDescending(log => log.Id)
                .Take(fetchCount)
                .Select(log => new ActivityProjection
                {
                    Id = log.Id,
                    RestaurantId = log.RestaurantId,
                    OccurredAt = log.CreatedAt,
                    Category = log.EventType.StartsWith("refund") ? "Refund" : "Payment",
                    EventType = log.EventType,
                    ActorUserId = log.ActorUserId,
                    ActorName = log.ActorDisplayName,
                    ActorRoles = log.ActorRoles,
                    ActorType = log.ActorType,
                    Source = log.Source ?? log.Provider,
                    CorrelationId = log.CorrelationId ?? log.ProviderEventId,
                    SubjectType = log.PaymentRefundId.HasValue ? "Refund" : "Payment",
                    OrderId = log.OrderId,
                    OrderNumber = log.OrderNumber,
                    PaymentId = log.PaymentId,
                    Provider = log.Provider,
                    ProviderEventId = log.ProviderEventId,
                    Status = log.Status,
                    Message = log.Message,
                    TechnicalJson = log.DataJson
                })
                .ToListAsync(cancellationToken)
            : [];

        var projections = auditRows
            .Concat(orderRows)
            .Concat(paymentRows)
            .OrderByDescending(item => item.OccurredAt)
            .ThenByDescending(item => item.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToList();

        var restaurantIds = projections
            .Where(item => item.RestaurantId.HasValue)
            .Select(item => item.RestaurantId!.Value)
            .Distinct()
            .ToArray();
        var restaurants = restaurantIds.Length == 0
            ? new Dictionary<Guid, RestaurantActivityContext>()
            : await dbContext.Restaurants
                .AsNoTracking()
                .Where(restaurant => restaurantIds.Contains(restaurant.Id))
                .Select(restaurant => new RestaurantActivityContext(
                    restaurant.Id,
                    restaurant.Name,
                    restaurant.Timezone))
                .ToDictionaryAsync(restaurant => restaurant.Id, cancellationToken);

        return new PagedResponse<ActivityLogResponse>
        {
            Items = projections
                .Select(item => MapActivity(item, restaurants, includeTechnicalDetails))
                .ToList(),
            Page = page,
            PageSize = pageSize,
            TotalItems = auditCount + orderCount + paymentCount
        };
    }

    public async Task<ActivitySummaryResponse> GetSummaryAsync(
        Guid? requestedRestaurantId,
        Guid? currentRestaurantId,
        bool isPlatformOwner,
        CancellationToken cancellationToken)
    {
        var summaryRestaurantId = requestedRestaurantId ?? (isPlatformOwner ? null : currentRestaurantId);
        var timeZoneId = summaryRestaurantId.HasValue
            ? await dbContext.Restaurants
                .AsNoTracking()
                .Where(restaurant => restaurant.Id == summaryRestaurantId.Value)
                .Select(restaurant => restaurant.Timezone)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        var timeZone = ResolveTimeZone(timeZoneId);
        var localToday = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone).Date;
        var today = TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localToday, DateTimeKind.Unspecified),
            timeZone);
        var tomorrow = TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localToday.AddDays(1), DateTimeKind.Unspecified),
            timeZone);

        var auditQuery = Scope(dbContext.AuditLogs.AsNoTracking(), currentRestaurantId, requestedRestaurantId, isPlatformOwner)
            .Where(log => log.CreatedAt >= today && log.CreatedAt < tomorrow)
            .Where(log => log.Action != "Auth.TokenRefreshed")
            .Where(log =>
                !log.Action.StartsWith("Order.") &&
                !log.Action.StartsWith("Payment.") &&
                !log.Action.StartsWith("PaymentRefund.") &&
                !log.Action.StartsWith("RefundRequest."));
        var orderQuery = Scope(dbContext.OrderEventLogs.AsNoTracking(), currentRestaurantId, requestedRestaurantId, isPlatformOwner)
            .Where(log => log.CreatedAt >= today && log.CreatedAt < tomorrow)
            .Where(log => !log.EventType.StartsWith("payment."));
        var paymentEventQuery = Scope(dbContext.PaymentEventLogs.AsNoTracking(), currentRestaurantId, requestedRestaurantId, isPlatformOwner)
            .Where(log => log.CreatedAt >= today && log.CreatedAt < tomorrow);

        var completedOrdersQuery = Scope(dbContext.OrderEventLogs.AsNoTracking(), currentRestaurantId, requestedRestaurantId, isPlatformOwner)
            .Where(log => log.CreatedAt >= today && log.CreatedAt < tomorrow)
            .Where(log => log.EventType == "order.status_changed")
            .Where(log => log.Message.Contains("Completed") || (log.DataJson != null && log.DataJson.Contains("Completed")))
            .Select(log => log.OrderId)
            .Distinct();

        var paymentsQuery = dbContext.Payments
            .AsNoTracking()
            .Where(payment => payment.PaidAt >= today && payment.PaidAt < tomorrow);
        paymentsQuery = ScopePayments(paymentsQuery, currentRestaurantId, requestedRestaurantId, isPlatformOwner);

        var refundsQuery = dbContext.PaymentRefunds
            .AsNoTracking()
            .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
            .Where(refund => refund.RefundedAt >= today && refund.RefundedAt < tomorrow);
        refundsQuery = ScopeRefunds(refundsQuery, currentRestaurantId, requestedRestaurantId, isPlatformOwner);

        var failedPaymentsQuery = dbContext.Payments
            .AsNoTracking()
            .Where(payment => payment.Status == PaymentStatus.Failed)
            .Where(payment => payment.FailedAt >= today && payment.FailedAt < tomorrow);
        failedPaymentsQuery = ScopePayments(failedPaymentsQuery, currentRestaurantId, requestedRestaurantId, isPlatformOwner);

        var auditCount = await auditQuery.CountAsync(cancellationToken);
        var orderCount = await orderQuery.CountAsync(cancellationToken);
        var paymentEventCount = await paymentEventQuery.CountAsync(cancellationToken);
        var completedOrders = await completedOrdersQuery.CountAsync(cancellationToken);
        var paymentTotals = await paymentsQuery
            .GroupBy(payment => payment.Currency.ToUpper())
            .Select(group => new ActivityMoneyTotalResponse
            {
                Currency = group.Key,
                Count = group.Count(),
                AmountCents = group.Sum(payment => payment.AmountCents)
            })
            .OrderBy(total => total.Currency)
            .ToListAsync(cancellationToken);
        var refundTotals = await refundsQuery
            .GroupBy(refund => refund.Currency.ToUpper())
            .Select(group => new ActivityMoneyTotalResponse
            {
                Currency = group.Key,
                Count = group.Count(),
                AmountCents = group.Sum(refund => refund.AmountCents)
            })
            .OrderBy(total => total.Currency)
            .ToListAsync(cancellationToken);
        var failedPayments = await failedPaymentsQuery.CountAsync(cancellationToken);

        return new ActivitySummaryResponse
        {
            TimeZone = timeZone.Id,
            ActivityCountToday = auditCount + orderCount + paymentEventCount,
            CompletedOrdersToday = completedOrders,
            PaymentsReceivedToday = paymentTotals,
            RefundsSucceededToday = refundTotals,
            FailedPaymentsToday = failedPayments
        };
    }

    private IQueryable<AuditLog> BuildAuditQuery(
        ActivityLogListRequest request,
        Guid? currentRestaurantId,
        bool isPlatformOwner)
    {
        var query = Scope(dbContext.AuditLogs.AsNoTracking(), currentRestaurantId, request.RestaurantId, isPlatformOwner)
            .Where(log => log.Action != "Auth.TokenRefreshed")
            .Where(log =>
                !log.Action.StartsWith("Order.") &&
                !log.Action.StartsWith("Payment.") &&
                !log.Action.StartsWith("PaymentRefund.") &&
                !log.Action.StartsWith("RefundRequest."));
        query = ApplyDates(query, request.CreatedFrom, request.CreatedTo);

        var category = request.Category?.Trim().ToLowerInvariant();
        if (!string.IsNullOrWhiteSpace(category))
        {
            query = category switch
            {
                "account" => query.Where(log => log.Action.StartsWith("Auth.") || log.Action.StartsWith("Mfa.") || log.Action.StartsWith("Passkey.")),
                "restaurant" => query.Where(log => log.Action.StartsWith("Restaurant.") || log.Action.StartsWith("Table.")),
                "menu" => query.Where(log => log.Action.StartsWith("Menu")),
                "user" => query.Where(log => log.Action.StartsWith("User.")),
                "system" => query.Where(log =>
                    !log.Action.StartsWith("Auth.") &&
                    !log.Action.StartsWith("Mfa.") &&
                    !log.Action.StartsWith("Passkey.") &&
                    !log.Action.StartsWith("Restaurant.") &&
                    !log.Action.StartsWith("Table.") &&
                    !log.Action.StartsWith("Menu") &&
                    !log.Action.StartsWith("User.")),
                _ => query.Where(_ => false)
            };
        }

        query = ApplyActorType(query, request.ActorType);
        query = ApplyOutcome(query, request.Outcome);

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.Action, pattern) ||
                EF.Functions.ILike(log.EntityType, pattern) ||
                (log.EntityId != null && EF.Functions.ILike(log.EntityId, pattern)) ||
                (log.Summary != null && EF.Functions.ILike(log.Summary, pattern)) ||
                (log.ActorEmail != null && EF.Functions.ILike(log.ActorEmail, pattern)));
        }

        return query;
    }

    private IQueryable<OrderEventLog> BuildOrderQuery(
        ActivityLogListRequest request,
        Guid? currentRestaurantId,
        bool isPlatformOwner)
    {
        var query = Scope(dbContext.OrderEventLogs.AsNoTracking(), currentRestaurantId, request.RestaurantId, isPlatformOwner)
            .Where(log => !log.EventType.StartsWith("payment."));
        query = ApplyDates(query, request.CreatedFrom, request.CreatedTo);
        query = ApplyActorType(query, request.ActorType);
        query = ApplyOutcome(query, request.Outcome);

        var category = request.Category?.Trim().ToLowerInvariant();
        if (category == "refund")
        {
            query = query.Where(log => log.EventType.StartsWith("refund_"));
        }
        else if (category == "order")
        {
            query = query.Where(log => !log.EventType.StartsWith("refund_"));
        }
        else if (!string.IsNullOrWhiteSpace(category) && category is not ("order" or "refund"))
        {
            query = query.Where(_ => false);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.EventType, pattern) ||
                EF.Functions.ILike(log.Message, pattern) ||
                EF.Functions.ILike(log.OrderNumber, pattern) ||
                (log.ActorDisplayName != null && EF.Functions.ILike(log.ActorDisplayName, pattern)));
        }

        return query;
    }

    private IQueryable<PaymentEventLog> BuildPaymentQuery(
        ActivityLogListRequest request,
        Guid? currentRestaurantId,
        bool isPlatformOwner)
    {
        var query = Scope(dbContext.PaymentEventLogs.AsNoTracking(), currentRestaurantId, request.RestaurantId, isPlatformOwner);
        query = ApplyDates(query, request.CreatedFrom, request.CreatedTo);
        query = ApplyActorType(query, request.ActorType);
        query = ApplyOutcome(query, request.Outcome);

        var category = request.Category?.Trim().ToLowerInvariant();
        if (category == "refund")
        {
            query = query.Where(log => log.EventType.StartsWith("refund"));
        }
        else if (category == "payment")
        {
            query = query.Where(log => !log.EventType.StartsWith("refund"));
        }
        else if (!string.IsNullOrWhiteSpace(category) && category is not ("payment" or "refund"))
        {
            query = query.Where(_ => false);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(log =>
                EF.Functions.ILike(log.EventType, pattern) ||
                EF.Functions.ILike(log.Message, pattern) ||
                EF.Functions.ILike(log.Provider, pattern) ||
                (log.Status != null && EF.Functions.ILike(log.Status, pattern)) ||
                (log.OrderNumber != null && EF.Functions.ILike(log.OrderNumber, pattern)) ||
                (log.ActorDisplayName != null && EF.Functions.ILike(log.ActorDisplayName, pattern)));
        }

        return query;
    }

    private static ActivityLogResponse MapActivity(
        ActivityProjection item,
        IReadOnlyDictionary<Guid, RestaurantActivityContext> restaurants,
        bool includeTechnicalDetails)
    {
        restaurants.TryGetValue(item.RestaurantId ?? Guid.Empty, out var restaurant);
        var actorType = ResolveActorType(item);
        var actorName = ResolveActorName(item, actorType);
        var amountCents = GetJsonLong(item.TechnicalJson, "amountCents");
        var currency = GetJsonString(item.TechnicalJson, "currency")?.ToUpperInvariant();
        var status = item.Status ??
                     GetJsonString(item.TechnicalJson, "nextStatus") ??
                     GetJsonString(item.TechnicalJson, "status");

        return new ActivityLogResponse
        {
            Id = item.Id,
            RestaurantId = item.RestaurantId,
            RestaurantName = restaurant?.Name,
            RestaurantTimeZone = restaurant?.Timezone,
            OccurredAt = item.OccurredAt,
            Category = item.Category == "Audit" ? GetAuditCategory(item.EventType) : item.Category,
            Severity = GetSeverity(item.EventType, status),
            EventType = item.EventType,
            ActionLabel = GetActionLabel(item.EventType),
            ActorType = actorType,
            ActorName = actorName,
            ActorRoles = actorType is "User" or "Customer" ? item.ActorRoles : null,
            Source = ResolveSource(item, actorType),
            Description = GetHumanDescription(item, amountCents, currency, status),
            SubjectType = item.SubjectType,
            SubjectId = item.SubjectId ??
                        item.PaymentId?.ToString() ??
                        item.OrderId?.ToString(),
            SubjectLabel = item.OrderNumber ??
                           item.SubjectId ??
                           item.PaymentId?.ToString() ??
                           item.OrderId?.ToString(),
            OrderId = item.OrderId,
            OrderNumber = item.OrderNumber,
            PaymentId = item.PaymentId,
            Status = NormalizeStatus(status),
            AmountCents = amountCents,
            Currency = currency,
            CorrelationId = item.CorrelationId ??
                            item.ProviderEventId ??
                            item.PaymentId?.ToString() ??
                            item.OrderId?.ToString() ??
                            item.SubjectId,
            TechnicalJson = includeTechnicalDetails ? item.TechnicalJson : null
        };
    }

    private static string GetHumanDescription(
        ActivityProjection item,
        long? amountCents,
        string? currency,
        string? status)
    {
        var order = item.OrderNumber ?? "the order";
        var amount = amountCents.HasValue
            ? $"{(currency ?? "AUD").ToUpperInvariant()} {(amountCents.Value / 100m).ToString("0.00", CultureInfo.InvariantCulture)}"
            : null;

        return item.EventType switch
        {
            "order.created" => $"placed order {order}.",
            "order.auto_accepted" => $"accepted order {order} automatically.",
            "order.status_changed" when string.Equals(status, "Completed", StringComparison.OrdinalIgnoreCase) =>
                $"completed order {order}.",
            "order.status_changed" =>
                $"changed order {order} to {NormalizeStatus(status) ?? "a new status"}.",
            "refund_request.approved" => $"approved the refund request for {order}.",
            "refund_request.rejected" => $"rejected the refund request for {order}.",
            "counter.recorded" when amount is not null => $"received {amount} at the counter for {order}.",
            "counter.recorded" => $"recorded a counter payment for {order}.",
            "checkout_session.created" => $"created a Stripe checkout session for {order}.",
            "checkout_session.failed" => $"could not create a Stripe checkout session for {order}.",
            "checkout.session.completed" when amount is not null => $"confirmed receipt of {amount} for {order}.",
            "checkout.session.completed" => $"confirmed payment for {order}.",
            "payment_intent.payment_failed" => $"reported a failed payment for {order}.",
            "refund.requested" when amount is not null => $"requested a {amount} refund for {order}.",
            "refund.updated" when amount is not null => $"updated the {amount} refund for {order} to {NormalizeStatus(status)}.",
            "refund.updated" => $"updated the refund for {order} to {NormalizeStatus(status)}.",
            "refund.failed" => $"reported a failed refund for {order}.",
            _ when item.EventType.StartsWith("Auth.Login", StringComparison.OrdinalIgnoreCase) ||
                   item.EventType.Contains("LoginSucceeded", StringComparison.OrdinalIgnoreCase) =>
                "signed in.",
            _ when !string.IsNullOrWhiteSpace(item.Message) => EnsureSentence(item.Message),
            _ => $"performed {GetActionLabel(item.EventType).ToLowerInvariant()}."
        };
    }

    private static string ResolveActorType(ActivityProjection item)
    {
        if (!string.IsNullOrWhiteSpace(item.ActorType))
        {
            return item.ActorType;
        }

        if (item.EventType == "order.auto_accepted")
        {
            return "Automation";
        }

        if ((item.EventType.StartsWith("Auth.", StringComparison.OrdinalIgnoreCase) ||
             item.EventType.Contains("LoginSucceeded", StringComparison.OrdinalIgnoreCase)) &&
            !string.IsNullOrWhiteSpace(GetJsonString(item.TechnicalJson, "email")))
        {
            return "User";
        }

        if (item.ActorUserId is not null)
        {
            return item.ActorRoles?.Contains("Customer", StringComparison.OrdinalIgnoreCase) == true
                ? "Customer"
                : "User";
        }

        if (item.EventType == "order.created")
        {
            return "Customer";
        }

        if (string.Equals(item.Provider, PaymentProviders.Stripe, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(item.Source, PaymentProviders.Stripe, StringComparison.OrdinalIgnoreCase))
        {
            return "Provider";
        }

        return "System";
    }

    private static string ResolveActorName(ActivityProjection item, string actorType)
    {
        if (actorType == "Automation")
        {
            return "DineFlow automation";
        }

        if (actorType == "Provider")
        {
            return item.Provider ?? item.Source ?? "Payment provider";
        }

        if (!string.IsNullOrWhiteSpace(item.ActorName))
        {
            return item.ActorName;
        }

        var payloadEmail = GetJsonString(item.TechnicalJson, "email");
        if (!string.IsNullOrWhiteSpace(payloadEmail))
        {
            return payloadEmail;
        }

        return actorType switch
        {
            "Automation" => "DineFlow automation",
            "Provider" => item.Provider ?? item.Source ?? "Payment provider",
            "Customer" => "Customer",
            "User" => "DineFlow user",
            _ => "DineFlow"
        };
    }

    private static string ResolveSource(ActivityProjection item, string actorType) =>
        !string.IsNullOrWhiteSpace(item.Source)
            ? item.Source
            : actorType == "Provider"
                ? item.Provider ?? "Payment provider"
                : "DineFlow";

    private static string GetSeverity(string eventType, string? status)
    {
        if (eventType.Contains("failed", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(status, "Failed", StringComparison.OrdinalIgnoreCase))
        {
            return "Error";
        }

        if (eventType.Contains("rejected", StringComparison.OrdinalIgnoreCase) ||
            eventType.Contains("cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(status, "Cancelled", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(status, "Expired", StringComparison.OrdinalIgnoreCase))
        {
            return "Warning";
        }

        return "Success";
    }

    private static string GetActionLabel(string eventType) => eventType switch
    {
        "order.created" => "Order placed",
        "order.auto_accepted" => "Order auto-accepted",
        "order.status_changed" => "Order status changed",
        "refund_request.approved" => "Refund approved",
        "refund_request.rejected" => "Refund rejected",
        "counter.recorded" => "Counter payment received",
        "checkout_session.created" => "Checkout started",
        "checkout_session.failed" => "Checkout failed",
        "checkout.session.completed" => "Payment received",
        "payment_intent.payment_failed" => "Payment failed",
        "refund.requested" => "Refund requested",
        "refund.updated" => "Refund updated",
        "refund.failed" => "Refund failed",
        _ => HumanizeIdentifier(eventType)
    };

    private static string GetAuditCategory(string action)
    {
        if (action.StartsWith("Auth.") || action.StartsWith("Mfa.") || action.StartsWith("Passkey."))
        {
            return "Account";
        }

        if (action.StartsWith("Restaurant.") || action.StartsWith("Table."))
        {
            return "Restaurant";
        }

        if (action.StartsWith("Menu"))
        {
            return "Menu";
        }

        return action.StartsWith("User.") ? "User" : "System";
    }

    private static string HumanizeIdentifier(string value)
    {
        var tail = value.Contains('.') ? value[(value.LastIndexOf('.') + 1)..] : value;
        var chars = new List<char>(tail.Length + 8);
        for (var index = 0; index < tail.Length; index++)
        {
            var current = tail[index];
            if (current is '_' or '-')
            {
                chars.Add(' ');
                continue;
            }

            if (index > 0 && char.IsUpper(current) && char.IsLower(tail[index - 1]))
            {
                chars.Add(' ');
            }

            chars.Add(current);
        }

        var result = new string(chars.ToArray()).Trim();
        return string.IsNullOrWhiteSpace(result)
            ? "Activity"
            : char.ToUpperInvariant(result[0]) + result[1..].ToLowerInvariant();
    }

    private static string EnsureSentence(string value)
    {
        value = value.Trim();
        return value.EndsWith('.') ? value : $"{value}.";
    }

    private static string? NormalizeStatus(string? status) => status switch
    {
        "0" => "Pending",
        "1" => "Succeeded",
        "2" => "Failed",
        "3" => "Cancelled",
        "4" => "Expired",
        "5" => "Refunded",
        "6" => "Partially refunded",
        "7" => "Not required",
        "8" => "Unpaid",
        _ => status
    };

    private static string? GetJsonString(string? json, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty(propertyName, out var value))
            {
                return null;
            }

            return value.ValueKind switch
            {
                JsonValueKind.String => value.GetString(),
                JsonValueKind.Number => value.GetRawText(),
                _ => null
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static TimeZoneInfo ResolveTimeZone(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    private static long? GetJsonLong(string? json, string propertyName)
    {
        var raw = GetJsonString(json, propertyName);
        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    private static IQueryable<AuditLog> ApplyDates(IQueryable<AuditLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue) query = query.Where(log => log.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(log => log.CreatedAt <= to.Value);
        return query;
    }

    private static IQueryable<OrderEventLog> ApplyDates(IQueryable<OrderEventLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue) query = query.Where(log => log.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(log => log.CreatedAt <= to.Value);
        return query;
    }

    private static IQueryable<PaymentEventLog> ApplyDates(IQueryable<PaymentEventLog> query, DateTime? from, DateTime? to)
    {
        if (from.HasValue) query = query.Where(log => log.CreatedAt >= from.Value);
        if (to.HasValue) query = query.Where(log => log.CreatedAt <= to.Value);
        return query;
    }

    private static IQueryable<AuditLog> ApplyActorType(IQueryable<AuditLog> query, string? actorType)
    {
        if (string.IsNullOrWhiteSpace(actorType)) return query;
        actorType = actorType.Trim();
        if (actorType.Equals("User", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "User" ||
                (log.ActorType == null && (log.ActorUserId != null || log.Action.StartsWith("Auth."))));
        }
        if (actorType.Equals("Customer", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "Customer" ||
                (log.ActorType == null && log.ActorRoles != null && log.ActorRoles.Contains("Customer")));
        }
        return actorType.Equals("System", StringComparison.OrdinalIgnoreCase)
            ? query.Where(log => log.ActorType == "System" || (log.ActorType == null && log.ActorUserId == null))
            : query.Where(log => log.ActorType == actorType);
    }

    private static IQueryable<OrderEventLog> ApplyActorType(IQueryable<OrderEventLog> query, string? actorType)
    {
        if (string.IsNullOrWhiteSpace(actorType)) return query;
        actorType = actorType.Trim();
        if (actorType.Equals("Automation", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log => log.ActorType == "Automation" || log.EventType == "order.auto_accepted");
        }
        if (actorType.Equals("Customer", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "Customer" ||
                (log.ActorType == null &&
                 (log.EventType == "order.created" ||
                  (log.ActorRoles != null && log.ActorRoles.Contains("Customer")))));
        }
        if (actorType.Equals("User", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "User" ||
                (log.ActorType == null &&
                 log.ActorUserId != null &&
                 (log.ActorRoles == null || !log.ActorRoles.Contains("Customer"))));
        }
        if (actorType.Equals("System", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log => log.ActorType == "System" || (log.ActorType == null && log.ActorUserId == null && log.EventType != "order.auto_accepted" && log.EventType != "order.created"));
        }
        return query.Where(log => log.ActorType == actorType);
    }

    private static IQueryable<PaymentEventLog> ApplyActorType(IQueryable<PaymentEventLog> query, string? actorType)
    {
        if (string.IsNullOrWhiteSpace(actorType)) return query;
        actorType = actorType.Trim();
        if (actorType.Equals("Provider", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log => log.ActorType == "Provider" || (log.ActorType == null && log.ActorUserId == null && log.Provider == PaymentProviders.Stripe));
        }
        if (actorType.Equals("System", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log => log.ActorType == "System" || (log.ActorType == null && log.ActorUserId == null && log.Provider != PaymentProviders.Stripe));
        }
        if (actorType.Equals("User", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "User" ||
                (log.ActorType == null &&
                 log.ActorUserId != null &&
                 (log.ActorRoles == null || !log.ActorRoles.Contains("Customer"))));
        }
        if (actorType.Equals("Customer", StringComparison.OrdinalIgnoreCase))
        {
            return query.Where(log =>
                log.ActorType == "Customer" ||
                (log.ActorType == null && log.ActorRoles != null && log.ActorRoles.Contains("Customer")));
        }
        return query.Where(log => log.ActorType == actorType);
    }

    private static IQueryable<AuditLog> ApplyOutcome(IQueryable<AuditLog> query, string? outcome)
    {
        if (string.IsNullOrWhiteSpace(outcome)) return query;
        return outcome.Trim().ToLowerInvariant() switch
        {
            "failed" => query.Where(log => EF.Functions.ILike(log.Action, "%failed%")),
            "success" => query.Where(log => !EF.Functions.ILike(log.Action, "%failed%")),
            "warning" => query.Where(log => EF.Functions.ILike(log.Action, "%rejected%") || EF.Functions.ILike(log.Action, "%cancelled%")),
            _ => query
        };
    }

    private static IQueryable<OrderEventLog> ApplyOutcome(IQueryable<OrderEventLog> query, string? outcome)
    {
        if (string.IsNullOrWhiteSpace(outcome)) return query;
        return outcome.Trim().ToLowerInvariant() switch
        {
            "failed" => query.Where(log => EF.Functions.ILike(log.EventType, "%failed%")),
            "warning" => query.Where(log => EF.Functions.ILike(log.EventType, "%rejected%") || EF.Functions.ILike(log.EventType, "%cancelled%")),
            "success" => query.Where(log => !EF.Functions.ILike(log.EventType, "%failed%") && !EF.Functions.ILike(log.EventType, "%rejected%")),
            _ => query
        };
    }

    private static IQueryable<PaymentEventLog> ApplyOutcome(IQueryable<PaymentEventLog> query, string? outcome)
    {
        if (string.IsNullOrWhiteSpace(outcome)) return query;
        return outcome.Trim().ToLowerInvariant() switch
        {
            "failed" => query.Where(log => log.Status == "Failed" || EF.Functions.ILike(log.EventType, "%failed%")),
            "warning" => query.Where(log => log.Status == "Cancelled" || log.Status == "Expired"),
            "success" => query.Where(log =>
                log.Status == "Paid" ||
                log.Status == "Succeeded" ||
                log.EventType == "counter.recorded" ||
                log.EventType == "checkout.session.completed"),
            _ => query
        };
    }

    private static IQueryable<AuditLog> Scope(
        IQueryable<AuditLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId,
        bool isPlatformOwner)
    {
        if (!isPlatformOwner) query = query.Where(log => log.RestaurantId == currentRestaurantId);
        return requestedRestaurantId.HasValue ? query.Where(log => log.RestaurantId == requestedRestaurantId) : query;
    }

    private static IQueryable<OrderEventLog> Scope(
        IQueryable<OrderEventLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId,
        bool isPlatformOwner)
    {
        if (!isPlatformOwner) query = query.Where(log => log.RestaurantId == currentRestaurantId);
        return requestedRestaurantId.HasValue ? query.Where(log => log.RestaurantId == requestedRestaurantId) : query;
    }

    private static IQueryable<PaymentEventLog> Scope(
        IQueryable<PaymentEventLog> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId,
        bool isPlatformOwner)
    {
        if (!isPlatformOwner) query = query.Where(log => log.RestaurantId == currentRestaurantId);
        return requestedRestaurantId.HasValue ? query.Where(log => log.RestaurantId == requestedRestaurantId) : query;
    }

    private static IQueryable<Payment> ScopePayments(
        IQueryable<Payment> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId,
        bool isPlatformOwner)
    {
        if (!isPlatformOwner) query = query.Where(payment => payment.Order != null && payment.Order.RestaurantId == currentRestaurantId);
        return requestedRestaurantId.HasValue
            ? query.Where(payment => payment.Order != null && payment.Order.RestaurantId == requestedRestaurantId)
            : query;
    }

    private static IQueryable<PaymentRefund> ScopeRefunds(
        IQueryable<PaymentRefund> query,
        Guid? currentRestaurantId,
        Guid? requestedRestaurantId,
        bool isPlatformOwner)
    {
        if (!isPlatformOwner) query = query.Where(refund => refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.RestaurantId == currentRestaurantId);
        return requestedRestaurantId.HasValue
            ? query.Where(refund => refund.Payment != null && refund.Payment.Order != null && refund.Payment.Order.RestaurantId == requestedRestaurantId)
            : query;
    }

    private sealed class ActivityProjection
    {
        public Guid Id { get; init; }
        public Guid? RestaurantId { get; init; }
        public DateTime OccurredAt { get; init; }
        public string Category { get; init; } = string.Empty;
        public string EventType { get; init; } = string.Empty;
        public string? ActorUserId { get; init; }
        public string? ActorName { get; init; }
        public string? ActorRoles { get; init; }
        public string? ActorType { get; init; }
        public string? Source { get; init; }
        public string? CorrelationId { get; init; }
        public string? SubjectType { get; init; }
        public string? SubjectId { get; init; }
        public Guid? OrderId { get; init; }
        public string? OrderNumber { get; init; }
        public Guid? PaymentId { get; init; }
        public string? Provider { get; init; }
        public string? ProviderEventId { get; init; }
        public string? Status { get; init; }
        public string? Message { get; init; }
        public string? TechnicalJson { get; init; }
    }

    private sealed record RestaurantActivityContext(Guid Id, string Name, string Timezone);
}
