using System.Security.Claims;
using System.Text.Json;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Reporting;

namespace DineFlow.Api.Services;

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
        object? after = null)
    {
        var actor = GetActor();
        _dbContext.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurantId,
            ActorUserId = actor.UserId,
            ActorEmail = actor.Email,
            ActorRoles = actor.Roles,
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
        object? data = null)
    {
        var actor = GetActor();
        _dbContext.OrderEventLogs.Add(new OrderEventLog
        {
            Id = Guid.NewGuid(),
            RestaurantId = order.RestaurantId,
            OrderId = order.Id,
            OrderNumber = Trim(order.OrderNumber, 80),
            ActorUserId = actor.UserId,
            ActorDisplayName = actor.DisplayName,
            ActorRoles = actor.Roles,
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
        string provider = PaymentProviders.Stripe)
    {
        var actor = GetActor();
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
            CreatedAt = DateTime.UtcNow
        });
    }

    private ActorContext GetActor()
    {
        var httpContext = _httpContextAccessor.HttpContext;
        var user = httpContext?.User;
        var roles = user?.Claims
            .Where(claim => claim.Type == ClaimTypes.Role)
            .Select(claim => claim.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(role => role)
            .ToArray() ?? [];

        return new ActorContext(
            UserId: user?.FindFirstValue(ClaimTypes.NameIdentifier),
            Email: user?.FindFirstValue(ClaimTypes.Email),
            DisplayName: user?.FindFirstValue(ClaimTypes.Name)
                ?? user?.FindFirstValue("name")
                ?? user?.FindFirstValue(ClaimTypes.Email),
            Roles: roles.Length == 0 ? null : string.Join(",", roles),
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
        string? IpAddress,
        string? UserAgent);
}
