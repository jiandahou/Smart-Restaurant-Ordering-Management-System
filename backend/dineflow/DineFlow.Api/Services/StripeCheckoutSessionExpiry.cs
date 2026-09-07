using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Stripe;
using Stripe.Checkout;

namespace DineFlow.Api.Services;

/// <summary>
/// Closes the Stripe Checkout page for an order that is no longer being made.
/// </summary>
/// <remarks>
/// <para>
/// Cancelling an unpaid order left its hosted Checkout page live and chargeable for the rest of
/// Stripe's ordinary hour. The local attempt was marked Cancelled at once, so for that hour the two
/// systems disagreed about whether money could still be taken — and the side that decides is
/// Stripe's. A customer who left the tab open, or came back to it from their history, could pay for
/// an order the kitchen had already released the stock for.
/// </para>
/// <para>
/// Expiry is asked for, not assumed. A Stripe outage must not stop a restaurant cancelling an
/// order, so a failure here is recorded and left to the reconciliation sweeper rather than thrown:
/// the alternative is an order that cannot be cancelled because a third party is down.
/// </para>
/// <para>
/// Sessions Stripe has already completed or expired are not an error. Both mean the page is no
/// longer chargeable, which is the whole point of asking.
/// </para>
/// </remarks>
public sealed class StripeCheckoutSessionExpiry(
    IStripeClient stripeClient,
    ReportLogWriter reportLogWriter,
    ILogger<StripeCheckoutSessionExpiry> logger)
{
    /// <summary>Attempts a customer could still pay through. Anything settled is left alone.</summary>
    public static bool IsStillChargeable(Payment payment) =>
        payment.Provider == PaymentProviders.Stripe
        && !string.IsNullOrWhiteSpace(payment.ProviderCheckoutSessionId)
        && payment.Status is PaymentStatus.Pending
            or PaymentStatus.Unpaid
            or PaymentStatus.Failed
            or PaymentStatus.Cancelled;

    /// <summary>
    /// Expires every live Checkout Session on the order and marks the local attempts Expired.
    /// </summary>
    /// <returns>How many sessions Stripe confirmed are no longer chargeable.</returns>
    public async Task<int> ExpireOpenSessionsAsync(
        Order order,
        string reason,
        CancellationToken cancellationToken)
    {
        var closed = 0;
        var now = DateTime.UtcNow;

        foreach (var payment in order.Payments.Where(IsStillChargeable))
        {
            // Stripe will not keep a Checkout Session payable for longer than a day, whatever we
            // asked for when we made it. Past that the page is dead as a matter of arithmetic, and
            // saying so here costs nothing and rescues the orders Stripe can no longer be asked
            // about — a session created under an account that has since changed, or one from
            // another environment's data, answers resource_missing forever. Left waiting on an
            // answer that will never come, those orders held their stock for good and, being the
            // oldest, sat at the front of every batch and crowded newer ones out of it.
            if (payment.CreatedAt <= now - HostedCheckoutExpiry.Maximum)
            {
                payment.Status = PaymentStatus.Expired;
                payment.UpdatedAt = now;
                RecordExpiry(order, payment, reason, "past-stripes-maximum-session-lifetime");
                closed += 1;
                continue;
            }

            try
            {
                await new SessionService(stripeClient).ExpireAsync(
                    payment.ProviderCheckoutSessionId,
                    new SessionExpireOptions(),
                    new RequestOptions { StripeAccount = payment.StripeAccountId },
                    cancellationToken);

                payment.Status = PaymentStatus.Expired;
                payment.UpdatedAt = now;
                RecordExpiry(order, payment, reason, "cancelled-order");
                closed += 1;
            }
            catch (StripeException error) when (IsAlreadyExpired(error))
            {
                // Stripe got there first. The page is unchargeable, which is what was asked for,
                // and the local attempt may say so too.
                payment.Status = PaymentStatus.Expired;
                payment.UpdatedAt = now;
                RecordExpiry(order, payment, reason, "already-expired-at-stripe");
                closed += 1;
            }
            catch (StripeException error) when (IsAlreadyCompleted(error))
            {
                // Someone paid between the decision to cancel and this call. Recording that as
                // Expired would erase a real payment; the sync service reads the true state, and a
                // paid-but-cancelled order is a refund question rather than a status one.
                logger.LogWarning(
                    "Checkout session {SessionId} for order {OrderId} was already paid when cancelling ({Reason}). The payment stands and needs refunding.",
                    payment.ProviderCheckoutSessionId,
                    order.Id,
                    reason);
            }
            catch (Exception error)
            {
                // Deliberately swallowed. The order still cancels; the sweeper picks the session up
                // at Stripe's own expiry, which is exactly the behaviour this replaces rather than
                // regresses.
                logger.LogError(
                    error,
                    "Could not expire checkout session {SessionId} for order {OrderId} ({Reason}). The session stays live until Stripe's own expiry.",
                    payment.ProviderCheckoutSessionId,
                    order.Id,
                    reason);
            }
        }

        return closed;
    }

    /// <summary>
    /// Writes the terminal transition to the payment timeline.
    /// </summary>
    /// <remarks>
    /// Orders and Payments showed Expired while the timeline still ended at
    /// checkout_session.created / Pending. An audit that stops before the terminal transition
    /// cannot answer the only question it is ever asked: when did this stop being payable, and who
    /// decided.
    /// </remarks>
    private void RecordExpiry(Order order, Payment payment, string reason, string source) =>
        reportLogWriter.AddPaymentEvent(
            order,
            payment,
            refund: null,
            "checkout_session.expired",
            providerEventId: payment.ProviderCheckoutSessionId,
            status: nameof(PaymentStatus.Expired),
            $"Checkout session closed without payment ({reason}).",
            data: new
            {
                sessionId = payment.ProviderCheckoutSessionId,
                source,
                reason,
            },
            actorOverride: ReportActor.Automation("DineFlow order cancellation"));

    /// <summary>Stripe's way of saying it had already expired the page itself.</summary>
    public static bool IsAlreadyExpired(StripeException error) =>
        error.StripeError?.Code == "checkout_session_expired"
        || Describes(error, "expired");

    /// <summary>
    /// Stripe's way of saying the page was paid. Kept apart from expiry because the two need
    /// opposite handling: one is the outcome that was wanted, the other is money that now has to
    /// come back.
    /// </summary>
    public static bool IsAlreadyCompleted(StripeException error) =>
        error.StripeError?.Code == "checkout_session_completed"
        || Describes(error, "completed");

    private static bool Describes(StripeException error, string word) =>
        (error.StripeError?.Message?.Contains(word, StringComparison.OrdinalIgnoreCase) ?? false)
        && (error.StripeError?.Message?.Contains("already", StringComparison.OrdinalIgnoreCase) ?? false);
}
