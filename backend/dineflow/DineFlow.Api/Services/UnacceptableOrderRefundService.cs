using DineFlow.Api.Options;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

/// <summary>
/// FS-017. Refunds paid orders the restaurant is no longer in a position to accept.
///
/// <para>
/// The trigger is deliberately "the restaurant cannot take this order" rather than "the order is
/// old". A busy kitchen running late still intends to cook, and cancelling on a timer would take
/// food away from a customer who wants it at exactly the moment the restaurant is least able to
/// respond. A closed or paused restaurant is a different situation: nobody is coming to accept it,
/// so holding the customer's money serves no one.
/// </para>
///
/// <para>
/// A grace period runs first so a brief pause during service, or an order placed seconds before
/// closing time, is not refunded out from under a kitchen that was about to accept it.
/// </para>
/// </summary>
public sealed class UnacceptableOrderRefundService(
    IServiceScopeFactory scopeFactory,
    IOptions<StripeOptions> stripeOptions,
    ILogger<UnacceptableOrderRefundService> logger) : BackgroundService
{
    /// <summary>How long a closed restaurant is given to accept before the order is released.</summary>
    internal static readonly TimeSpan ClosedGracePeriod = TimeSpan.FromMinutes(10);

    internal static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(2);
    internal const int BatchSize = 25;

    private readonly StripeOptions _stripeOptions = stripeOptions.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            logger.LogInformation(
                "Automatic refunds for unacceptable orders are disabled because Stripe is not configured.");
            return;
        }

        using var timer = new PeriodicTimer(ScanInterval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RefundBatchAsync(stoppingToken);
        }
    }

    internal async Task<int> RefundBatchAsync(CancellationToken cancellationToken)
    {
        var refunded = 0;

        try
        {
            using var scope = scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var refundProcessor = scope.ServiceProvider.GetRequiredService<OrderRefundProcessor>();
            var operatingHours = scope.ServiceProvider.GetRequiredService<RestaurantOperatingHoursService>();

            var now = DateTime.UtcNow;
            var cutoff = now - ClosedGracePeriod;

            var candidates = await dbContext.Orders
                .Include(order => order.Restaurant)
                .Include(order => order.Payments)
                .Where(order =>
                    order.Status == OrderStatus.Pending &&
                    order.PaymentMethod == PaymentMethod.Online &&
                    order.PaymentStatus == PaymentStatus.Paid &&
                    order.CreatedAt <= cutoff &&
                    order.Restaurant != null)
                .OrderBy(order => order.CreatedAt)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            foreach (var order in candidates)
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                var restaurant = order.Restaurant!;
                var availability = operatingHours.GetAvailability(restaurant, now);

                if (availability.IsOrderingAvailable)
                {
                    // Still trading — this is the busy-kitchen case, which the staff escalations
                    // and the customer's own cancellation right cover instead.
                    continue;
                }

                var paidAt = order.Payments
                    .Where(payment => payment.PaidAt.HasValue)
                    .Max(payment => payment.PaidAt);

                if (OrderAcceptancePolicy.WaitedForAcceptance(paidAt, order.CreatedAt, now) < ClosedGracePeriod)
                {
                    continue;
                }

                if (await RefundOrderAsync(dbContext, refundProcessor, order, availability.Message, now, cancellationToken))
                {
                    refunded++;
                }
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Automatic refund sweep for unacceptable orders failed.");
        }

        return refunded;
    }

    private async Task<bool> RefundOrderAsync(
        AppDbContext dbContext,
        OrderRefundProcessor refundProcessor,
        Order order,
        string closureMessage,
        DateTime now,
        CancellationToken cancellationToken)
    {
        var reason = string.IsNullOrWhiteSpace(closureMessage)
            ? "The restaurant is closed and could not accept this order."
            : $"The restaurant could not accept this order: {closureMessage}";

        var restaurantName = string.IsNullOrWhiteSpace(order.Restaurant?.Name)
            ? "The restaurant"
            : order.Restaurant!.Name;

        var result = await refundProcessor.RefundAsync(
            order,
            requestedByUserId: null,
            reason: reason,
            source: "auto-unacceptable-order",
            cancellationToken: cancellationToken,
            // One key per order so a retried sweep cannot refund the same order twice.
            idempotencyKeySeed: $"unacceptable-order-{order.Id:N}",
            // Nobody asked for this refund, so the mail has to say why it happened — otherwise the
            // customer sees money come back with no explanation and no idea whether to reorder.
            customerExplanation: $"{restaurantName} was not able to accept this order, so it has "
                + "been cancelled and your payment refunded in full. You have not been charged. "
                + "You are welcome to order again when the restaurant reopens.");

        if (!result.IsSuccess)
        {
            logger.LogWarning(
                "Could not automatically refund unacceptable order {OrderNumber}: {Message}",
                order.OrderNumber,
                result.Message);
            return false;
        }

        order.Status = OrderStatus.Cancelled;
        order.UpdatedAt = now;
        dbContext.OrderStatusHistories.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            PreviousStatus = OrderStatus.Pending,
            NewStatus = OrderStatus.Cancelled,
            Action = "AutoCancelUnacceptable",
            Reason = reason,
            CreatedAt = now
        });

        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Automatically refunded and cancelled {OrderNumber}: {Reason}",
            order.OrderNumber,
            reason);

        return true;
    }
}
