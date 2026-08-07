using System.Data;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Options;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using OrderEntity = DineFlow.Infrastructure.Orders.Order;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Api.Services;

public sealed class StripeOrderCheckoutService
{
    private readonly AppDbContext _dbContext;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly OrderRealtimeNotifier _orderRealtimeNotifier;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly ILogger<StripeOrderCheckoutService> _logger;

    public StripeOrderCheckoutService(
        AppDbContext dbContext,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        OrderRealtimeNotifier orderRealtimeNotifier,
        ReportLogWriter reportLogWriter,
        ILogger<StripeOrderCheckoutService> logger)
    {
        _dbContext = dbContext;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _orderRealtimeNotifier = orderRealtimeNotifier;
        _reportLogWriter = reportLogWriter;
        _logger = logger;
    }

    private enum CheckoutSessionReuse
    {
        Reusable,
        Unusable,
        AlreadyCompleted,
        Indeterminate
    }

    /// Only an "open", unexpired session can still take payment. Anything else must not be handed
    /// back to the customer as a live checkout URL.
    private async Task<CheckoutSessionReuse> InspectCheckoutSessionAsync(
        string sessionId,
        string stripeAccountId,
        CancellationToken cancellationToken)
    {
        try
        {
            var session = await new SessionService(_stripeClient).GetAsync(
                sessionId,
                requestOptions: new RequestOptions { StripeAccount = stripeAccountId },
                cancellationToken: cancellationToken);

            if (string.Equals(session.Status, "complete", StringComparison.OrdinalIgnoreCase))
            {
                return CheckoutSessionReuse.AlreadyCompleted;
            }

            if (!string.Equals(session.Status, "open", StringComparison.OrdinalIgnoreCase))
            {
                return CheckoutSessionReuse.Unusable;
            }

            return session.ExpiresAt != default && session.ExpiresAt <= DateTime.UtcNow
                ? CheckoutSessionReuse.Unusable
                : CheckoutSessionReuse.Reusable;
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(
                ex,
                "Could not verify checkout session {SessionId}; preserving it because its state is indeterminate.",
                sessionId);
            return CheckoutSessionReuse.Indeterminate;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Unexpected failure while verifying checkout session {SessionId}; preserving it because its state is indeterminate.",
                sessionId);
            return CheckoutSessionReuse.Indeterminate;
        }
    }

    public async Task<StripeCheckoutStartResult> StartAsync(
        Guid orderId,
        string? customerEmail,
        string? returnTo,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StripeCheckoutStartResult.Failure(
                StatusCodes.Status503ServiceUnavailable,
                "Stripe is not configured.");
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);

        var order = await _dbContext.Orders
            .Include(item => item.OrderItems)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == orderId, cancellationToken);

        if (order is null)
        {
            return StripeCheckoutStartResult.Failure(StatusCodes.Status404NotFound, "Order not found.");
        }

        if (order.OrderItems.Count == 0)
        {
            return StripeCheckoutStartResult.Failure(StatusCodes.Status400BadRequest, "Order has no items to pay for.");
        }

        if (order.PaymentStatus is PaymentStatus.Paid
            or PaymentStatus.Refunded
            or PaymentStatus.PartiallyRefunded
            or PaymentStatus.NotRequired)
        {
            return StripeCheckoutStartResult.Failure(StatusCodes.Status409Conflict, "This order cannot be paid online.");
        }

        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return StripeCheckoutStartResult.Failure(
                StatusCodes.Status409Conflict,
                "This order is configured for payment at the counter.");
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return StripeCheckoutStartResult.Failure(
                StatusCodes.Status400BadRequest,
                "Cancelled or rejected orders cannot be paid.");
        }

        var restaurant = order.Restaurant;
        if (restaurant is null ||
            string.IsNullOrWhiteSpace(restaurant.StripeAccountId) ||
            !restaurant.StripeChargesEnabled)
        {
            return StripeCheckoutStartResult.Failure(
                StatusCodes.Status409Conflict,
                "Online payment is not available until this restaurant completes Stripe onboarding.");
        }

        var payment = await _dbContext.Payments
            .Where(item =>
                item.OrderId == order.Id &&
                item.Provider == PaymentProviders.Stripe &&
                item.Status == PaymentStatus.Pending &&
                item.StripeAccountId == restaurant.StripeAccountId &&
                item.IdempotencyKey != null)
            .OrderByDescending(item => item.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (payment is not null &&
            !string.IsNullOrWhiteSpace(payment.ProviderCheckoutSessionId) &&
            !string.IsNullOrWhiteSpace(payment.CheckoutUrl))
        {
            // A locally-Pending payment says nothing about whether Stripe still accepts the
            // session — they expire (24h by default). Ask Stripe before handing the URL back.
            var reuse = await InspectCheckoutSessionAsync(
                payment.ProviderCheckoutSessionId!,
                restaurant.StripeAccountId!,
                cancellationToken);

            if (reuse == CheckoutSessionReuse.Reusable)
            {
                await transaction.CommitAsync(cancellationToken);
                return StripeCheckoutStartResult.Success(MapResponse(order, payment, "Existing checkout session reused."));
            }

            if (reuse == CheckoutSessionReuse.AlreadyCompleted)
            {
                // Stripe already took payment and we simply have not processed the webhook yet.
                // Minting a second session here is how customers get charged twice.
                await transaction.CommitAsync(cancellationToken);
                return StripeCheckoutStartResult.Failure(
                    StatusCodes.Status409Conflict,
                    "This order has already been paid. Refresh to see the updated payment status.");
            }

            if (reuse == CheckoutSessionReuse.Indeterminate)
            {
                // The old URL may still be live or may even have completed. Preserve both the
                // session and its idempotency key; replacing either while Stripe is unreachable
                // can create a second payable Checkout Session.
                await transaction.CommitAsync(cancellationToken);
                return StripeCheckoutStartResult.Failure(
                    StatusCodes.Status502BadGateway,
                    "The existing checkout session could not be confirmed with Stripe.",
                    "The original payment link was preserved. Please wait and try again; no new checkout session was created.");
            }

            _logger.LogInformation(
                "Replacing unusable checkout session {SessionId} for payment {PaymentId}.",
                payment.ProviderCheckoutSessionId,
                payment.Id);

            // Drop the dead session and rotate the idempotency key, otherwise Stripe would just
            // replay the expired session instead of creating a new one.
            payment.ProviderCheckoutSessionId = null;
            payment.CheckoutUrl = null;
            payment.IdempotencyKey = $"order-checkout-{payment.Id:N}-{Guid.NewGuid():N}";
            payment.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var amountCents = PricingCalculator.ToMinorCurrencyUnits(order.TotalAmount);
        var currency = NormalizeCurrency(restaurant.Currency);

        if (payment is null)
        {
            payment = new Payment
            {
                OrderId = order.Id,
                Provider = PaymentProviders.Stripe,
                StripeAccountId = restaurant.StripeAccountId,
                AmountCents = amountCents,
                Currency = currency,
                PlatformFeeAmountCents = PlatformFeeCalculator.CalculateOrderFee(
                    amountCents,
                    restaurant.OrderPlatformFeeBps),
                Status = PaymentStatus.Pending,
                CreatedAt = DateTime.UtcNow
            };
            payment.IdempotencyKey = $"order-checkout-{payment.Id:N}";
            _dbContext.Payments.Add(payment);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var metadata = new Dictionary<string, string>
        {
            ["mode"] = "order",
            ["restaurantId"] = restaurant.Id.ToString(),
            ["orderId"] = order.Id.ToString(),
            ["paymentId"] = payment.Id.ToString()
        };
        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AppendSessionId(AddReturnTo(_stripeOptions.SuccessUrl, returnTo)),
            CancelUrl = AddReturnTo(_stripeOptions.CancelUrl, returnTo),
            CustomerEmail = string.IsNullOrWhiteSpace(customerEmail) ? null : customerEmail.Trim(),
            LineItems = order.OrderItems
                .OrderBy(item => item.CreatedAt)
                .ThenBy(item => item.Id)
                .Select(item => new SessionLineItemOptions
                {
                    Quantity = item.Quantity,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = currency,
                        UnitAmount = PricingCalculator.ToMinorCurrencyUnits(item.UnitPrice),
                        ProductData = new SessionLineItemPriceDataProductDataOptions
                        {
                            Name = string.IsNullOrWhiteSpace(item.MenuItemNameSnapshot)
                                ? "Menu item"
                                : item.MenuItemNameSnapshot.Trim()
                        }
                    }
                })
                .ToList(),
            Metadata = metadata,
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                ApplicationFeeAmount = payment.PlatformFeeAmountCents > 0
                    ? payment.PlatformFeeAmountCents
                    : null,
                Metadata = metadata
            }
        };
        var requestOptions = new RequestOptions
        {
            StripeAccount = restaurant.StripeAccountId,
            IdempotencyKey = payment.IdempotencyKey
        };

        try
        {
            var service = new SessionService(_stripeClient);
            var session = await service.CreateAsync(
                sessionOptions,
                requestOptions,
                cancellationToken);

            payment.ProviderCheckoutSessionId = session.Id;
            payment.ProviderPaymentIntentId = session.PaymentIntentId;
            payment.CheckoutUrl = session.Url;
            payment.UpdatedAt = DateTime.UtcNow;
            order.PaymentStatus = PaymentStatus.Pending;
            order.UpdatedAt = DateTime.UtcNow;

            _reportLogWriter.AddAudit(
                "Payment.CheckoutSessionCreated",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"Stripe Connect checkout session created for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    paymentId = payment.Id,
                    stripeAccountId = restaurant.StripeAccountId,
                    sessionId = session.Id,
                    payment.AmountCents,
                    payment.PlatformFeeAmountCents,
                    payment.Currency
                });
            _reportLogWriter.AddPaymentEvent(
                order,
                payment,
                null,
                "checkout_session.created",
                session.Id,
                payment.Status.ToString(),
                "Stripe Connect direct-charge checkout session created.",
                new
                {
                    stripeAccountId = restaurant.StripeAccountId,
                    sessionId = session.Id,
                    payment.AmountCents,
                    payment.PlatformFeeAmountCents
                });

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

            return StripeCheckoutStartResult.Success(MapResponse(order, payment, "Checkout session created."));
        }
        catch (StripeException ex)
        {
            _logger.LogError(ex, "Stripe Connect failed to create checkout for order {OrderId}.", order.Id);

            payment.FailureReason = ex.StripeError?.Message ?? ex.Message;
            payment.UpdatedAt = DateTime.UtcNow;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await _orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

            return StripeCheckoutStartResult.Failure(
                StatusCodes.Status400BadRequest,
                "Payment could not be started. Please try again.",
                ex.StripeError?.Message ?? ex.Message);
        }
    }

    private static CreateCheckoutSessionResponse MapResponse(OrderEntity order, Payment payment, string message) =>
        new()
        {
            Message = message,
            SessionId = payment.ProviderCheckoutSessionId!,
            CheckoutUrl = payment.CheckoutUrl!,
            OrderId = order.Id,
            PaymentId = payment.Id
        };

    private static string NormalizeCurrency(string? currency) =>
        string.IsNullOrWhiteSpace(currency) ? "aud" : currency.Trim().ToLowerInvariant();

    private static string AddReturnTo(string url, string? returnTo) =>
        string.IsNullOrWhiteSpace(returnTo)
            ? url
            : QueryHelpers.AddQueryString(url, "returnTo", returnTo);

    private static string AppendSessionId(string url) =>
        QueryHelpers.AddQueryString(url, "session_id", "{CHECKOUT_SESSION_ID}");
}

public sealed record StripeCheckoutStartResult(
    bool IsSuccess,
    int StatusCode,
    string Message,
    string? Detail,
    CreateCheckoutSessionResponse? Response)
{
    public static StripeCheckoutStartResult Success(CreateCheckoutSessionResponse response) =>
        new(true, StatusCodes.Status200OK, response.Message, null, response);

    public static StripeCheckoutStartResult Failure(int statusCode, string message, string? detail = null) =>
        new(false, statusCode, message, detail, null);
}
