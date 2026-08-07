using DineFlow.Api.Options;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;

namespace DineFlow.Api.Services;

public sealed record PaymentSyncResult(bool IsSuccess, int StatusCode, string? Message = null)
{
    public static PaymentSyncResult Success() => new(true, StatusCodes.Status200OK);

    public static PaymentSyncResult Failure(int statusCode, string message) =>
        new(false, statusCode, message);
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
    ReportLogWriter reportLogWriter,
    ILogger<PaymentSyncService> logger)
{
    private readonly StripeOptions _stripeOptions = stripeOptions.Value;

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

            if (payment.Order is not null && payment.Status != previousStatus)
            {
                payment.Order.PaymentStatus = payment.Status;
                payment.Order.UpdatedAt = now;
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
