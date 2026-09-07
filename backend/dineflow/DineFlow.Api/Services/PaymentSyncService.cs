using DineFlow.Api.Options;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace DineFlow.Api.Services;

public sealed record PaymentSyncResult(
    bool IsSuccess,
    int StatusCode,
    string? Message = null,
    bool StateIsSettled = false)
{
    public static PaymentSyncResult Success() => new(true, StatusCodes.Status200OK);

    public static PaymentSyncResult Failure(int statusCode, string message) =>
        new(false, statusCode, message);

    /// <summary>
    /// Nothing more will be collected, and the record now says so.
    /// </summary>
    /// <remarks>
    /// A checkout flow has to treat this as a refusal — there is no money and it must not proceed —
    /// while someone who pressed Re-sync got exactly what they asked for: a definite answer, written
    /// down. Reporting it to them as a failure left the screen showing the state they had just
    /// corrected.
    /// </remarks>
    public static PaymentSyncResult Settled(int statusCode, string message) =>
        new(false, statusCode, message, StateIsSettled: true);
}

/// <summary>
/// Pulls the authoritative state for a payment straight from Stripe. This is the manual recovery
/// path for payments stranded by a dropped webhook, and the only way we learn Stripe's processing
/// fee and dispute state — neither arrives through the checkout flow.
/// </summary>
public sealed class PaymentSyncService(
    AppDbContext dbContext,
    IStripeClient stripeClient,
    IOptions<StripeOptions> stripeOptions,
    OrderPaymentLanding orderPaymentLanding,
    OrderRealtimeNotifier orderRealtimeNotifier,
    ReportLogWriter reportLogWriter,
    ILogger<PaymentSyncService> logger)
{
    private readonly StripeOptions _stripeOptions = stripeOptions.Value;

    public async Task<PaymentSyncResult> SyncCheckoutSessionAsync(
        Payment payment,
        string? actorUserId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return PaymentSyncResult.Failure(StatusCodes.Status503ServiceUnavailable, "Stripe is not configured.");
        }

        if (string.IsNullOrWhiteSpace(payment.ProviderCheckoutSessionId))
        {
            return await SyncAsync(payment, actorUserId, cancellationToken);
        }

        try
        {
            var session = await new SessionService(stripeClient).GetAsync(
                payment.ProviderCheckoutSessionId,
                new SessionGetOptions(),
                new RequestOptions { StripeAccount = payment.StripeAccountId },
                cancellationToken);

            if (!string.IsNullOrWhiteSpace(session.PaymentIntentId))
            {
                payment.ProviderPaymentIntentId = session.PaymentIntentId;
            }

            // A session Stripe has expired will never produce a payment intent, and the check below
            // would have kept answering "not yet" forever. Left Pending, the order is invisible to
            // the abandoned-order sweeper — which deliberately spares Pending, on the reasoning that
            // the customer may be on the card form — so it holds its stock for good. One was found
            // still holding a portion four hours after Stripe had closed the session.
            if (session.Status == "expired")
            {
                payment.Status = PaymentStatus.Expired;
                payment.UpdatedAt = DateTime.UtcNow;

                if (payment.Order is not null
                    && payment.Order.PaymentStatus == PaymentStatus.Pending)
                {
                    payment.Order.PaymentStatus = PaymentStatus.Expired;
                    payment.Order.UpdatedAt = DateTime.UtcNow;
                }

                // The state moved and the audit did not, so Orders and Payments showed Expired
                // while the payment timeline still ended at checkout_session.created / Pending.
                // A timeline that stops before the terminal transition cannot answer the only
                // question it is ever asked: when did this stop being payable, and who decided.
                reportLogWriter.AddPaymentEvent(
                    payment.Order,
                    payment,
                    refund: null,
                    "checkout_session.expired",
                    providerEventId: payment.ProviderCheckoutSessionId,
                    status: nameof(PaymentStatus.Expired),
                    "Stripe closed the checkout session without payment.",
                    data: new
                    {
                        sessionId = payment.ProviderCheckoutSessionId,
                        source = "checkout-session-sync",
                        providerStatus = session.Status,
                        providerExpiresAt = session.ExpiresAt,
                    });

                await dbContext.SaveChangesAsync(cancellationToken);

                return PaymentSyncResult.Settled(
                    StatusCodes.Status409Conflict,
                    "The Stripe Checkout session expired without payment.");
            }

            if (string.IsNullOrWhiteSpace(payment.ProviderPaymentIntentId))
            {
                return PaymentSyncResult.Failure(
                    StatusCodes.Status409Conflict,
                    "Stripe has not created a payment intent for this checkout session yet.");
            }

            return await SyncAsync(payment, actorUserId, cancellationToken);
        }
        catch (StripeException ex)
        {
            logger.LogWarning(ex, "Stripe checkout session sync failed for payment {PaymentId}.", payment.Id);
            return PaymentSyncResult.Failure(
                StatusCodes.Status502BadGateway,
                ex.StripeError?.Message ?? "Stripe could not be reached.");
        }
    }

    public async Task<PaymentSyncResult> SyncAsync(
        Payment payment,
        string? actorUserId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return PaymentSyncResult.Failure(StatusCodes.Status503ServiceUnavailable, "Stripe is not configured.");
        }

        if (string.IsNullOrWhiteSpace(payment.ProviderPaymentIntentId))
        {
            return PaymentSyncResult.Failure(
                StatusCodes.Status409Conflict,
                "This payment has no Stripe payment intent to sync.");
        }

        if (payment.ProviderPaymentIntentId.Contains("_demo_", StringComparison.OrdinalIgnoreCase))
        {
            return PaymentSyncResult.Failure(
                StatusCodes.Status409Conflict,
                "Seeded demo payments cannot be synced with Stripe.");
        }

        var requestOptions = new RequestOptions { StripeAccount = payment.StripeAccountId };

        try
        {
            // Expanding in one call keeps this to a single round trip and gives us the fee, which
            // only exists on the charge's balance transaction.
            var intent = await new PaymentIntentService(stripeClient).GetAsync(
                payment.ProviderPaymentIntentId,
                new PaymentIntentGetOptions
                {
                    Expand = ["latest_charge", "latest_charge.balance_transaction"],
                },
                requestOptions,
                cancellationToken);

            var now = DateTime.UtcNow;
            var previousStatus = payment.Status;
            var incomingStatus = MapIntentStatus(intent.Status);

            // Stripe is authoritative here — this is exactly the case the webhook missed — but the
            // same one-way rules apply so a sync can never walk a refund back.
            if (PaymentStatePolicy.CanApplyProviderStatus(payment.Status, incomingStatus))
            {
                payment.Status = incomingStatus;

                if (incomingStatus == PaymentStatus.Paid)
                {
                    payment.PaidAt ??= now;
                    payment.FailedAt = null;
                    payment.FailureReason = null;
                }
                else if (incomingStatus is PaymentStatus.Failed or PaymentStatus.Cancelled)
                {
                    payment.FailedAt ??= now;
                    payment.FailureReason = intent.LastPaymentError?.Message ?? payment.FailureReason;
                }
            }

            ApplyChargeDetails(payment, intent.LatestCharge, now);

            payment.LastSyncedAt = now;
            payment.UpdatedAt = now;

            var statusChanged = payment.Status != previousStatus;
            if (payment.Order is not null && statusChanged)
            {
                payment.Order.PaymentStatus = payment.Status;
                payment.Order.UpdatedAt = now;

                if (payment.Status == PaymentStatus.Paid)
                {
                    // Not TryAccept directly: the order may have been turned away while this
                    // payment was in flight, and accepting it would put food nobody ordered on the
                    // pass while the customer's money stayed.
                    await orderPaymentLanding.OnPaidAsync(payment.Order, actorUserId, cancellationToken);
                }
            }

            reportLogWriter.AddAudit(
                "Payment.SyncedFromStripe",
                "Payment",
                payment.Id.ToString(),
                payment.Order?.RestaurantId,
                $"Payment {payment.Id} synced from Stripe: {previousStatus} -> {payment.Status}.",
                after: new
                {
                    paymentId = payment.Id,
                    payment.OrderId,
                    previousStatus,
                    payment.Status,
                    payment.ProviderChargeId,
                    payment.StripeFeeAmountCents,
                    payment.NetAmountCents,
                    payment.DisputeStatus,
                    actorUserId
                });

            await dbContext.SaveChangesAsync(cancellationToken);

            if (payment.Order is not null && statusChanged)
            {
                await orderRealtimeNotifier.OrderPaymentUpdatedAsync(payment.Order, cancellationToken);
            }

            logger.LogInformation(
                "Synced payment {PaymentId} from Stripe: {Previous} -> {Current}.",
                payment.Id,
                previousStatus,
                payment.Status);

            return PaymentSyncResult.Success();
        }
        catch (StripeException ex)
        {
            logger.LogWarning(ex, "Stripe sync failed for payment {PaymentId}.", payment.Id);
            return PaymentSyncResult.Failure(
                StatusCodes.Status502BadGateway,
                ex.StripeError?.Message ?? "Stripe could not be reached.");
        }
    }

    private static void ApplyChargeDetails(Payment payment, Charge? charge, DateTime now)
    {
        if (charge is null)
        {
            return;
        }

        payment.ProviderChargeId = charge.Id;
        payment.ProviderReceiptUrl = charge.ReceiptUrl ?? payment.ProviderReceiptUrl;
        // Guest checkouts never store an email on the order, so the charge is often our only route
        // back to the payer. Fall back to the billing details Stripe collected.
        payment.ReceiptEmail = charge.ReceiptEmail
            ?? charge.BillingDetails?.Email
            ?? payment.ReceiptEmail;

        if (charge.BalanceTransaction is not null)
        {
            payment.StripeFeeAmountCents = charge.BalanceTransaction.Fee;
            payment.NetAmountCents = charge.BalanceTransaction.Net;
        }

        if (charge.Disputed)
        {
            payment.DisputeStatus ??= "disputed";
            payment.DisputedAt ??= now;
        }
    }

    private static PaymentStatus MapIntentStatus(string? status) =>
        status?.ToLowerInvariant() switch
        {
            "succeeded" => PaymentStatus.Paid,
            "canceled" => PaymentStatus.Cancelled,
            "requires_payment_method" or "requires_confirmation" or "requires_action"
                or "processing" or "requires_capture" => PaymentStatus.Pending,
            _ => PaymentStatus.Pending
        };
}
