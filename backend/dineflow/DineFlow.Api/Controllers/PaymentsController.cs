using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Options;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/payments")]
[Authorize]
public class PaymentsController : ControllerBase
{
    private const long MinimumTestAmountCents = 50;
    private const string TestOrderIdMetadataKey = "testOrderId";
    private readonly AppDbContext _dbContext;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly ILogger<PaymentsController> _logger;

    public PaymentsController(
        AppDbContext dbContext,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        ILogger<PaymentsController> logger)
    {
        _dbContext = dbContext;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _logger = logger;
    }

    [HttpPost("checkout-session/test")]
    public async Task<ActionResult<CreateCheckoutSessionResponse>> CreateTestCheckoutSession(
        CreateTestCheckoutSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe is not configured."
            });
        }

        if (request.AmountCents < MinimumTestAmountCents)
        {
            return BadRequest(new
            {
                message = $"Amount must be at least {MinimumTestAmountCents} cents."
            });
        }

        if (request.Quantity <= 0)
        {
            return BadRequest(new
            {
                message = "Quantity must be greater than zero."
            });
        }

        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = User.FindFirstValue(ClaimTypes.Email);
        var currency = NormalizeCurrency(request.Currency ?? _stripeOptions.Currency);
        var itemName = string.IsNullOrWhiteSpace(request.Name)
            ? "DineFlow test order"
            : request.Name.Trim();
        var testOrder = new TestPaymentOrder
        {
            UserId = userId,
            Name = itemName,
            AmountCents = request.AmountCents,
            Quantity = request.Quantity,
            Currency = currency,
            Status = TestPaymentStatuses.Pending
        };

        _dbContext.TestPaymentOrders.Add(testOrder);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AddCheckoutSessionId(_stripeOptions.SuccessUrl),
            CancelUrl = _stripeOptions.CancelUrl,
            CustomerEmail = string.IsNullOrWhiteSpace(email) ? null : email,
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Quantity = request.Quantity,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = currency,
                        UnitAmount = request.AmountCents,
                        ProductData = new SessionLineItemPriceDataProductDataOptions
                        {
                            Name = itemName
                        }
                    }
                }
            ],
            Metadata = new Dictionary<string, string>
            {
                ["mode"] = "test",
                ["userId"] = userId ?? string.Empty,
                [TestOrderIdMetadataKey] = testOrder.Id.ToString()
            },
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                Metadata = new Dictionary<string, string>
                {
                    ["mode"] = "test",
                    ["userId"] = userId ?? string.Empty,
                    [TestOrderIdMetadataKey] = testOrder.Id.ToString()
                }
            }
        };

        try
        {
            var service = new SessionService(_stripeClient);
            var session = await service.CreateAsync(sessionOptions, cancellationToken: cancellationToken);

            testOrder.StripeCheckoutSessionId = session.Id;
            testOrder.StripePaymentIntentId = session.PaymentIntentId;
            testOrder.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return Ok(new CreateCheckoutSessionResponse
            {
                Message = "Checkout session created.",
                SessionId = session.Id,
                CheckoutUrl = session.Url,
                TestOrderId = testOrder.Id
            });
        }
        catch (StripeException ex)
        {
            _logger.LogError(ex, "Stripe failed to create a test checkout session for user {UserId}.", userId);

            testOrder.Status = TestPaymentStatuses.Failed;
            testOrder.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            return BadRequest(new
            {
                message = "Failed to create Stripe checkout session.",
                detail = ex.StripeError?.Message ?? ex.Message
            });
        }
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("test-orders")]
    public async Task<ActionResult<IReadOnlyList<TestPaymentOrderResponse>>> GetTestOrders(CancellationToken cancellationToken)
    {
        var orders = await _dbContext.TestPaymentOrders
            .AsNoTracking()
            .OrderByDescending(order => order.CreatedAt)
            .Select(order => new TestPaymentOrderResponse
            {
                Id = order.Id,
                UserId = order.UserId,
                UserEmail = _dbContext.Users
                    .Where(user => user.Id == order.UserId)
                    .Select(user => user.Email)
                    .FirstOrDefault(),
                Name = order.Name,
                AmountCents = order.AmountCents,
                Quantity = order.Quantity,
                TotalCents = order.AmountCents * order.Quantity,
                Currency = order.Currency,
                Status = order.Status,
                StripeCheckoutSessionId = order.StripeCheckoutSessionId,
                StripePaymentIntentId = order.StripePaymentIntentId,
                CreatedAt = order.CreatedAt,
                UpdatedAt = order.UpdatedAt,
                PaidAt = order.PaidAt
            })
            .ToListAsync(cancellationToken);

        return Ok(orders);
    }

    [AllowAnonymous]
    [HttpPost("stripe/webhook")]
    public async Task<IActionResult> StripeWebhook(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_stripeOptions.WebhookSecret))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe webhook secret is not configured."
            });
        }

        var payload = await new StreamReader(HttpContext.Request.Body).ReadToEndAsync(cancellationToken);
        var signatureHeader = Request.Headers["Stripe-Signature"].ToString();
        Event stripeEvent;

        try
        {
            stripeEvent = EventUtility.ConstructEvent(
                payload,
                signatureHeader,
                _stripeOptions.WebhookSecret);
        }
        catch (StripeException ex)
        {
            _logger.LogWarning(ex, "Rejected Stripe webhook with invalid signature.");

            return BadRequest(new
            {
                message = "Invalid Stripe webhook signature."
            });
        }

        switch (stripeEvent.Type)
        {
            case "checkout.session.completed":
                await UpdateTestOrderFromCheckoutSessionAsync(stripeEvent, TestPaymentStatuses.Paid, cancellationToken);
                break;
            case "checkout.session.expired":
                await UpdateTestOrderFromCheckoutSessionAsync(stripeEvent, TestPaymentStatuses.Expired, cancellationToken);
                break;
            case "payment_intent.payment_failed":
                await UpdateTestOrderFromPaymentIntentAsync(stripeEvent, TestPaymentStatuses.Failed, cancellationToken);
                break;
            default:
                _logger.LogInformation("Ignored Stripe webhook event {EventType}.", stripeEvent.Type);
                break;
        }

        return Ok(new
        {
            received = true
        });
    }

    private static string NormalizeCurrency(string? currency)
    {
        return string.IsNullOrWhiteSpace(currency)
            ? "aud"
            : currency.Trim().ToLowerInvariant();
    }

    private static string AddCheckoutSessionId(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return "http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}";
        }

        var separator = url.Contains('?') ? '&' : '?';

        return url.Contains("{CHECKOUT_SESSION_ID}", StringComparison.Ordinal)
            ? url
            : $"{url}{separator}session_id={{CHECKOUT_SESSION_ID}}";
    }

    private async Task UpdateTestOrderFromCheckoutSessionAsync(
        Event stripeEvent,
        string status,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not Session session)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a checkout session.", stripeEvent.Type);
            return;
        }

        TestPaymentOrder? testOrder = null;

        if (session.Metadata.TryGetValue(TestOrderIdMetadataKey, out var testOrderId) &&
            Guid.TryParse(testOrderId, out var parsedTestOrderId))
        {
            testOrder = await _dbContext.TestPaymentOrders.FindAsync([parsedTestOrderId], cancellationToken);
        }

        testOrder ??= await _dbContext.TestPaymentOrders
            .FirstOrDefaultAsync(
                order => order.StripeCheckoutSessionId == session.Id,
                cancellationToken);

        if (testOrder is null)
        {
            _logger.LogWarning("No test payment order found for Stripe checkout session {SessionId}.", session.Id);
            return;
        }

        testOrder.Status = status;
        testOrder.StripeCheckoutSessionId = session.Id;
        testOrder.StripePaymentIntentId = session.PaymentIntentId;
        testOrder.UpdatedAt = DateTime.UtcNow;

        if (status == TestPaymentStatuses.Paid)
        {
            testOrder.PaidAt = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation(
            "Updated test payment order {TestOrderId} to {Status} from Stripe checkout session {SessionId}.",
            testOrder.Id,
            status,
            session.Id);
    }

    private async Task UpdateTestOrderFromPaymentIntentAsync(
        Event stripeEvent,
        string status,
        CancellationToken cancellationToken)
    {
        if (stripeEvent.Data.Object is not PaymentIntent paymentIntent)
        {
            _logger.LogWarning("Stripe event {EventType} did not contain a payment intent.", stripeEvent.Type);
            return;
        }

        TestPaymentOrder? testOrder = null;

        if (paymentIntent.Metadata.TryGetValue(TestOrderIdMetadataKey, out var testOrderId) &&
            Guid.TryParse(testOrderId, out var parsedTestOrderId))
        {
            testOrder = await _dbContext.TestPaymentOrders.FindAsync([parsedTestOrderId], cancellationToken);
        }

        testOrder ??= await _dbContext.TestPaymentOrders
            .FirstOrDefaultAsync(
                order => order.StripePaymentIntentId == paymentIntent.Id,
                cancellationToken);

        if (testOrder is null)
        {
            _logger.LogWarning("No test payment order found for Stripe payment intent {PaymentIntentId}.", paymentIntent.Id);
            return;
        }

        testOrder.Status = status;
        testOrder.StripePaymentIntentId = paymentIntent.Id;
        testOrder.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation(
            "Updated test payment order {TestOrderId} to {Status} from Stripe payment intent {PaymentIntentId}.",
            testOrder.Id,
            status,
            paymentIntent.Id);
    }
}
