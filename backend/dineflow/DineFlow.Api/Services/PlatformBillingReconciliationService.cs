using DineFlow.Api.Options;
using DineFlow.Infrastructure.Billing;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Api.Services;

/// <summary>
/// Asks Stripe where each billed restaurant actually stands, rather than waiting to be told.
/// </summary>
/// <remarks>
/// <para>
/// The activation fee has always been reconciled by webhook alone. Diner payments have a sweep
/// behind them — <see cref="PendingStripePaymentReconciliationService"/> — but it scans the payments
/// table, and an activation fee creates no payment row, so nothing has ever looked at one twice. A
/// dropped webhook therefore strands a restaurant in <see cref="PlatformSetupFeeStatus.Pending"/>
/// permanently. That was a cosmetic wrong status while nothing read it. It becomes a paying
/// customer with their ordering switched off the moment something does, and no feature should ship
/// that can only be correct when a network delivers.
/// </para>
/// <para>
/// So this exists before enforcement does, and it is the only thing allowed to decide that a
/// restaurant is behind. Webhooks record what Stripe said; this re-derives what it means, from all
/// the facts at once, every pass — which is why events arriving out of order cannot leave a clock
/// running that should have stopped.
/// </para>
/// </remarks>
public sealed class PlatformBillingReconciliationService(
    IServiceScopeFactory scopeFactory,
    IOptions<StripeOptions> stripeOptions,
    ILogger<PlatformBillingReconciliationService> logger) : BackgroundService
{
    internal static readonly TimeSpan ScanInterval = TimeSpan.FromMinutes(5);

    /// <summary>
    /// How long to leave a restaurant alone between asking Stripe about it.
    /// </summary>
    /// <remarks>
    /// Comfortably shorter than <see cref="PlatformBilling.MaxFactAge"/>, so a restaurant's facts
    /// stay fresh enough to act on in the ordinary course. If this ever exceeded that age, every
    /// restaurant would drift into "too stale to enforce" and the feature would quietly stop
    /// working — the safe direction, but silently.
    /// </remarks>
    internal static readonly TimeSpan RecheckCooldown = TimeSpan.FromHours(1);

    internal const int BatchSize = 25;

    private readonly StripeOptions _stripeOptions = stripeOptions.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            logger.LogInformation(
                "Platform billing reconciliation is disabled because Stripe is not configured.");
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
            var reportLogWriter = scope.ServiceProvider.GetRequiredService<ReportLogWriter>();
            var stripeClient = scope.ServiceProvider.GetRequiredService<IStripeClient>();
            var now = DateTime.UtcNow;
            var recheckCutoff = now.Subtract(RecheckCooldown);

            var restaurants = await dbContext.Restaurants
                .Where(restaurant =>
                    restaurant.PlatformBillingModel != PlatformBillingModel.None &&
                    (restaurant.PlatformBillingSyncedAt == null ||
                     restaurant.PlatformBillingSyncedAt <= recheckCutoff))
                .OrderBy(restaurant => restaurant.PlatformBillingSyncedAt)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            foreach (var restaurant in restaurants)
            {
                await ReconcileAsync(restaurant, stripeClient, reportLogWriter, now, cancellationToken);
            }

            if (restaurants.Count > 0)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Platform billing reconciliation batch failed.");
        }
    }

    private async Task ReconcileAsync(
        RestaurantEntity restaurant,
        IStripeClient stripeClient,
        ReportLogWriter reportLogWriter,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // Confirm with Stripe first, decide afterwards. Deciding on what we happen to hold is how a
        // missed webhook turns into a suspension.
        await RefreshActivationFeeAsync(restaurant, stripeClient, reportLogWriter, now, cancellationToken);

        DeriveDelinquency(restaurant, now);
    }

    /// <summary>
    /// Re-reads an outstanding activation-fee checkout from Stripe and applies whatever it says.
    /// </summary>
    private async Task RefreshActivationFeeAsync(
        RestaurantEntity restaurant,
        IStripeClient stripeClient,
        ReportLogWriter reportLogWriter,
        DateTime now,
        CancellationToken cancellationToken)
    {
        if (restaurant.PlatformBillingModel != PlatformBillingModel.OneTimeActivation ||
            restaurant.OneTimePlatformFeePaidAt.HasValue ||
            string.IsNullOrWhiteSpace(restaurant.OneTimePlatformFeeCheckoutSessionId))
        {
            // Nothing outstanding to ask about. The restaurant is still stamped as checked, because
            // "we looked and there was nothing owing" is exactly as good a fact as any other.
            restaurant.PlatformBillingSyncedAt = now;
            return;
        }

        Session session;
        try
        {
            session = await new SessionService(stripeClient).GetAsync(
                restaurant.OneTimePlatformFeeCheckoutSessionId,
                cancellationToken: cancellationToken);
        }
        catch (StripeException ex)
        {
            // Deliberately leaves PlatformBillingSyncedAt alone. Facts that could not be confirmed
            // must go stale, because staleness is what stops enforcement acting on a guess.
            logger.LogWarning(
                ex,
                "Could not read platform fee session {SessionId} for restaurant {RestaurantId}.",
                restaurant.OneTimePlatformFeeCheckoutSessionId,
                restaurant.Id);
            return;
        }

        var completed = string.Equals(session.Status, "complete", StringComparison.OrdinalIgnoreCase);
        var outcome = PlatformFeeSessionApplier.Apply(
            restaurant,
            session.Id,
            completed,
            session.PaymentStatus,
            session.PaymentIntentId,
            now);

        if (outcome is PlatformFeeSessionOutcome.Ignored or PlatformFeeSessionOutcome.AwaitingPayment)
        {
            return;
        }

        reportLogWriter.AddAudit(
            PlatformFeeSessionApplier.AuditEvent(outcome),
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            PlatformFeeSessionApplier.Describe(outcome, restaurant.Name),
            after: new
            {
                sessionId = session.Id,
                session.Status,
                session.PaymentStatus,
                recoveredWithoutWebhook = true,
            },
            actorOverride: ReportActor.Automation());
    }

    /// <summary>
    /// Starts or stops the one delinquency clock, from the facts as they now stand.
    /// </summary>
    /// <remarks>
    /// This is the sole writer of <see cref="RestaurantEntity.PlatformBillingDelinquentSince"/> in
    /// the starting direction; webhooks may only clear it. The rule itself lives in
    /// <see cref="PlatformBilling.DeriveDelinquentSince"/> so it can be tested without a database
    /// and cannot drift from the standing it feeds.
    /// </remarks>
    private static void DeriveDelinquency(RestaurantEntity restaurant, DateTime now)
    {
        restaurant.PlatformBillingDelinquentSince =
            PlatformBilling.DeriveDelinquentSince(restaurant.ToBillingSnapshot(), now);

        if (restaurant.PlatformBillingDelinquentSince is null)
        {
            restaurant.PlatformBillingSuspendedAt = null;
        }
    }
}
