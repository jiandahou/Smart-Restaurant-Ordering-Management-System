using DineFlow.Api.Options;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

/// <summary>
/// Last-resort recovery for a successful Stripe payment whose webhook and customer return request
/// were both missed. Work is deliberately bounded and cooled down so multiple pending payments do
/// not turn into an aggressive Stripe polling loop.
/// </summary>
public sealed class PendingStripePaymentReconciliationService(
    IServiceScopeFactory scopeFactory,
    IOptions<StripeOptions> stripeOptions,
    ILogger<PendingStripePaymentReconciliationService> logger) : BackgroundService
{
    internal static readonly TimeSpan PendingGracePeriod = TimeSpan.FromMinutes(2);
    internal static readonly TimeSpan RecheckCooldown = TimeSpan.FromMinutes(5);
    internal static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(1);
    internal const int BatchSize = 25;

    private readonly StripeOptions _stripeOptions = stripeOptions.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            logger.LogInformation("Pending Stripe payment reconciliation is disabled because Stripe is not configured.");
            return;
        }

        using var timer = new PeriodicTimer(ScanInterval);

        await ReconcileBatchAsync(stoppingToken);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await ReconcileBatchAsync(stoppingToken);
        }
    }

    internal async Task ReconcileBatchAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var paymentSyncService = scope.ServiceProvider.GetRequiredService<PaymentSyncService>();
            var now = DateTime.UtcNow;
            var pendingCutoff = now.Subtract(PendingGracePeriod);
            var syncCutoff = now.Subtract(RecheckCooldown);

            var payments = await dbContext.Payments
                .Include(payment => payment.Order)
                    .ThenInclude(order => order!.Restaurant)
                .Where(payment =>
                    payment.Provider == PaymentProviders.Stripe &&
                    payment.Status == PaymentStatus.Pending &&
                    payment.CreatedAt <= pendingCutoff &&
                    (payment.LastSyncedAt == null || payment.LastSyncedAt <= syncCutoff) &&
                    (payment.ProviderPaymentIntentId != null || payment.ProviderCheckoutSessionId != null) &&
                    (payment.ProviderPaymentIntentId == null || !payment.ProviderPaymentIntentId.Contains("_demo_")))
                .OrderBy(payment => payment.CreatedAt)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            foreach (var payment in payments)
            {
                var result = await paymentSyncService.SyncCheckoutSessionAsync(
                    payment,
                    actorUserId: null,
                    cancellationToken);

                if (!result.IsSuccess)
                {
                    logger.LogWarning(
                        "Background Stripe reconciliation could not sync payment {PaymentId}: {Message}",
                        payment.Id,
                        result.Message);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Pending Stripe payment reconciliation batch failed.");
        }
    }
}
