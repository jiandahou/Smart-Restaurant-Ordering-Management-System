using System.Security.Claims;
using System.Text.Json;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;

namespace DineFlow.Api.Services;

public sealed record ReportActor(
    string Type,
    string DisplayName,
    string? UserId = null,
    string? Email = null,
    string? Roles = null,
    string Source = "DineFlow")
{
    public static ReportActor Automation(string displayName = "DineFlow automation") =>
        new("Automation", displayName, Source: "DineFlow");

    public static ReportActor Provider(string provider) =>
        new("Provider", provider, Source: provider);

    public static ReportActor User(
        string userId,
        string displayName,
        string? email,
        IEnumerable<string> roles) =>
        new("User", displayName, userId, email, string.Join(",", roles), "DineFlow");
}

public sealed class ReportLogWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly AppDbContext _dbContext;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public ReportLogWriter(AppDbContext dbContext, IHttpContextAccessor httpContextAccessor)
    {
        _dbContext = dbContext;
        _httpContextAccessor = httpContextAccessor;
    }

    public void AddAudit(
        string action,
        string entityType,
        string? entityId,
        Guid? restaurantId,
        string? summary,
        object? before = null,
        object? after = null,
        ReportActor? actorOverride = null,
        string? correlationId = null)
    {
        var actor = GetActor(actorOverride);
        _dbContext.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            ActorUserId = actor.UserId,
            ActorEmail = actor.Email,
            ActorRoles = actor.Roles,
            ActorType = actor.Type,
            Source = actor.Source,
            CorrelationId = TrimNullable(correlationId, 120),
            Action = Trim(action, 120),
            EntityType = Trim(entityType, 80),
            EntityId = TrimNullable(entityId, 120),
            Summary = TrimNullable(summary, 700),
            BeforeJson = Serialize(before),
            AfterJson = Serialize(after),
            IpAddress = actor.IpAddress,
            UserAgent = actor.UserAgent,
            CreatedAt = DateTime.UtcNow
        });
    }

    public void AddOrderEvent(
        Order order,
        string eventType,
        string message,
        object? data = null,
        ReportActor? actorOverride = null,
        string? correlationId = null)
    {
        var actor = GetActor(actorOverride);
        _dbContext.OrderEventLogs.Add(new OrderEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = order.RestaurantId,
            OrderId = order.Id,
            OrderNumber = Trim(order.OrderNumber, 80),
            ActorUserId = actor.UserId,
            ActorDisplayName = actor.DisplayName,
            ActorRoles = actor.Roles,
            ActorType = actor.Type,
            Source = actor.Source,
            CorrelationId = TrimNullable(correlationId, 120),
            EventType = Trim(eventType, 120),
            Message = Trim(message, 700),
            DataJson = Serialize(data),
            CreatedAt = DateTime.UtcNow
        });
    }

    public void AddPaymentEvent(
        Order? order,
        Payment? payment,
        PaymentRefund? refund,
        string eventType,
        string? providerEventId,
        string? status,
        string message,
        object? data = null,
        string provider = PaymentProviders.Stripe,
        ReportActor? actorOverride = null,
        string? correlationId = null)
    {
        var actor = GetActor(actorOverride);
        if (actor.UserId is null &&
            actorOverride is null &&
            string.Equals(provider, PaymentProviders.Stripe, StringComparison.OrdinalIgnoreCase))
        {
            actor = GetActor(ReportActor.Provider(PaymentProviders.Stripe));
        }

        _dbContext.PaymentEventLogs.Add(new PaymentEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = order?.RestaurantId,
            OrderId = order?.Id ?? payment?.OrderId,
            OrderNumber = order?.OrderNumber,
            PaymentId = payment?.Id ?? refund?.PaymentId,
            PaymentRefundId = refund?.Id,
            Provider = Trim(provider, 64),
            EventType = Trim(eventType, 120),
            ProviderEventId = TrimNullable(providerEventId, 255),
            Status = TrimNullable(status, 80),
            Message = Trim(message, 700),
            DataJson = Serialize(data),
            ActorUserId = actor.UserId,
            ActorDisplayName = actor.DisplayName,
            ActorRoles = actor.Roles,
            ActorType = actor.Type,
            Source = actor.Source,
            CorrelationId = TrimNullable(correlationId, 120),
            CreatedAt = DateTime.UtcNow
        });
    }

    private ActorContext GetActor(ReportActor? actorOverride = null)
    {
        if (actorOverride is not null)
        {
            return new ActorContext(
                actorOverride.UserId,
                actorOverride.Email,
                actorOverride.DisplayName,
                actorOverride.Roles,
                actorOverride.Type,
                actorOverride.Source,
                null,
                null);
        }

        var httpContext = _httpContextAccessor.HttpContext;
        var user = httpContext?.User;
        var roles = user?.Claims
            .Where(claim => claim.Type == ClaimTypes.Role)
            .Select(claim => claim.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(role => role)
            .ToArray() ?? [];

        var userId = user?.FindFirstValue(ClaimTypes.NameIdentifier);
        var actorType = userId is null
            ? "System"
            : roles.Contains("Customer", StringComparer.OrdinalIgnoreCase)
                ? "Customer"
                : "User";

        return new ActorContext(
            UserId: userId,
            Email: user?.FindFirstValue(ClaimTypes.Email),
            DisplayName: user?.FindFirstValue(ClaimTypes.Name)
                ?? user?.FindFirstValue("name")
                ?? user?.FindFirstValue(ClaimTypes.Email),
            Roles: roles.Length == 0 ? null : string.Join(",", roles),
            Type: actorType,
            Source: "DineFlow",
            IpAddress: TrimNullable(httpContext?.Connection.RemoteIpAddress?.ToString(), 64),
            UserAgent: TrimNullable(httpContext?.Request.Headers.UserAgent.ToString(), 512));
    }

    private static string? Serialize(object? value) =>
        value is null ? null : JsonSerializer.Serialize(value, JsonOptions);

    private static string Trim(string value, int maxLength)
    {
        value = string.IsNullOrWhiteSpace(value) ? "unknown" : value.Trim();
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static string? TrimNullable(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        value = value.Trim();
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private sealed record ActorContext(
        string? UserId,
        string? Email,
        string? DisplayName,
        string? Roles,
        string Type,
        string Source,
        string? IpAddress,
        string? UserAgent);
}
