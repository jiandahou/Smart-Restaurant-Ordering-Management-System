using System.Security.Claims;
using System.Globalization;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Extensions;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class RestaurantController : ControllerBase
{
    private const int MaximumImageUrlLength = 2_048;

    /// <summary>A timed pause is a rush-hour tool; anything longer should be an explicit pause.</summary>
    private const int MaximumPauseMinutes = 12 * 60;

    private static readonly HashSet<string> IsoCurrencyCodes = CultureInfo
        .GetCultures(CultureTypes.SpecificCultures)
        .Select(culture => new RegionInfo(culture.Name).ISOCurrencySymbol)
        .Where(currency => !string.IsNullOrWhiteSpace(currency))
        .Concat([
            "AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM",
            "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD",
            "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP",
            "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN",
            "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF",
            "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD",
            "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW",
            "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD",
            "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR",
            "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD",
            "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON",
            "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SLL",
            "SOS", "SRD", "SSP", "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND",
            "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS",
            "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR",
            "ZMW", "ZWL"
        ])
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly RestaurantOperatingHoursService _restaurantOperatingHoursService;
    private readonly IStripeClient _stripeClient;
    private readonly StripeOptions _stripeOptions;
    private readonly ILogger<RestaurantController> _logger;

    public RestaurantController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        ReportLogWriter reportLogWriter,
        RestaurantOperatingHoursService restaurantOperatingHoursService,
        IStripeClient stripeClient,
        IOptions<StripeOptions> stripeOptions,
        ILogger<RestaurantController> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _reportLogWriter = reportLogWriter;
        _restaurantOperatingHoursService = restaurantOperatingHoursService;
        _stripeClient = stripeClient;
        _stripeOptions = stripeOptions.Value;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<PagedResponse<RestaurantResponse>>> GetRestaurants(
        [FromQuery] RestaurantListRequest request,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.Restaurants.AsNoTracking();

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            var restaurantId = await GetCurrentRestaurantIdAsync();

            if (restaurantId is null)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "Current user is not assigned to a restaurant."
                });
            }

            query = query.Where(restaurant => restaurant.Id == restaurantId);
        }

        if (request.IsActive.HasValue)
        {
            query = query.Where(restaurant => restaurant.IsActive == request.IsActive.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.CountryCode))
        {
            var countryCode = NormalizeCountryCode(request.CountryCode);
            query = query.Where(restaurant => restaurant.CountryCode == countryCode);
        }

        if (!string.IsNullOrWhiteSpace(request.Currency))
        {
            var currency = request.Currency.Trim().ToUpperInvariant();
            query = query.Where(restaurant => restaurant.Currency == currency);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(restaurant =>
                EF.Functions.ILike(restaurant.Name, pattern) ||
                EF.Functions.ILike(restaurant.Address, pattern) ||
                EF.Functions.ILike(restaurant.Phone, pattern) ||
                EF.Functions.ILike(restaurant.CountryCode, pattern) ||
                EF.Functions.ILike(restaurant.Timezone, pattern) ||
                EF.Functions.ILike(restaurant.Currency, pattern));
        }

        var sortedQuery = ApplySorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "name", "address", "currency", "status", "createdAt", "updatedAt" }
            });
        }

        var responseQuery = sortedQuery.Select(restaurant => new RestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            ImageUrl = restaurant.ImageUrl,
            CountryCode = restaurant.CountryCode,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            PaymentPolicy = restaurant.PaymentPolicy.ToString(),
            StripeConnectStatus = restaurant.StripeAccountId == null || restaurant.StripeAccountId == ""
                ? "NotConnected"
                : restaurant.StripeChargesEnabled && restaurant.StripePayoutsEnabled
                    ? "Ready"
                    : restaurant.StripeDetailsSubmitted ? "Restricted" : "Onboarding",
            OnlinePaymentsEnabled = restaurant.StripeChargesEnabled &&
                restaurant.StripeAccountId != null &&
                restaurant.StripeAccountId != "",
            OrderPlatformFeePercent = restaurant.OrderPlatformFeeBps / 100m,
            OneTimePlatformFeeCents = restaurant.OneTimePlatformFeeCents,
            OneTimePlatformFeeStatus = restaurant.OneTimePlatformFeeStatus.ToString(),
            IsActive = restaurant.IsActive,
            AcceptingOrders = restaurant.AcceptingOrders,
            AcceptingOrdersPausedUntil = restaurant.AcceptingOrdersPausedUntil,
            AutoAcceptOrders = restaurant.AutoAcceptOrders,
            OpeningHoursJson = restaurant.OpeningHoursJson,
            SpecialOpeningDaysJson = restaurant.SpecialOpeningDaysJson,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        });
        var page = await responseQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

        // Availability can't be evaluated inside the EF projection, so fill it in once materialised.
        var utcNow = DateTime.UtcNow;
        foreach (var item in page.Items)
        {
            var availability = _restaurantOperatingHoursService.GetAvailability(
                item.IsActive,
                item.AcceptingOrders,
                item.AcceptingOrdersPausedUntil,
                item.Timezone,
                item.OpeningHoursJson,
                item.SpecialOpeningDaysJson,
                utcNow);

            item.Availability = new RestaurantAvailabilityResponse
            {
                IsOrderingAvailable = availability.IsOrderingAvailable,
                IsWithinOpeningHours = availability.IsWithinOpeningHours,
                AcceptingOrders = availability.AcceptingOrders,
                Reason = availability.Reason,
                Message = availability.Message,
                NextTransitionLocal = availability.NextTransitionLocal,
                NextOpeningLocal = availability.NextOpeningLocal,
                LocalNow = RestaurantOperatingHoursService.GetLocalNow(
                    new Restaurant { Timezone = item.Timezone },
                    utcNow),
                PausedUntilUtc = availability.PausedUntilUtc
            };
        }

        return Ok(page);
    }

    private static IOrderedQueryable<Restaurant>? ApplySorting(
        IQueryable<Restaurant> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "name" : sortBy.Trim();
        IOrderedQueryable<Restaurant>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "name" => descending ? query.OrderByDescending(restaurant => restaurant.Name) : query.OrderBy(restaurant => restaurant.Name),
            "address" => descending ? query.OrderByDescending(restaurant => restaurant.Address) : query.OrderBy(restaurant => restaurant.Address),
            "currency" => descending ? query.OrderByDescending(restaurant => restaurant.Currency) : query.OrderBy(restaurant => restaurant.Currency),
            "status" => descending ? query.OrderByDescending(restaurant => restaurant.IsActive) : query.OrderBy(restaurant => restaurant.IsActive),
            "createdat" => descending ? query.OrderByDescending(restaurant => restaurant.CreatedAt) : query.OrderBy(restaurant => restaurant.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(restaurant => restaurant.UpdatedAt) : query.OrderBy(restaurant => restaurant.UpdatedAt),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(restaurant => restaurant.Id)
                : sorted.ThenBy(restaurant => restaurant.Id);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetRestaurant(Guid id)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await _dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        return Ok(MapToResponse(restaurant));
    }

    [HttpGet("{id:guid}/payment-settings")]
    public async Task<ActionResult<RestaurantPaymentSettingsResponse>> GetPaymentSettings(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await _dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        return restaurant is null
            ? NotFound(new { message = "Restaurant not found." })
            : Ok(MapPaymentSettings(restaurant));
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPatch("{id:guid}/payment-settings")]
    public async Task<ActionResult<RestaurantPaymentSettingsResponse>> UpdatePaymentSettings(
        Guid id,
        UpdateRestaurantPlatformFeesRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        if (request.OneTimePlatformFeeCents is > 0 and < 50)
        {
            return BadRequest(new
            {
                message = "A non-zero one-time platform fee must be at least 50 minor currency units."
            });
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (restaurant.OneTimePlatformFeePaidAt.HasValue &&
            restaurant.OneTimePlatformFeeCents != request.OneTimePlatformFeeCents)
        {
            return Conflict(new
            {
                message = "The one-time platform fee is immutable after it has been paid."
            });
        }

        var before = new
        {
            restaurant.OrderPlatformFeeBps,
            restaurant.OneTimePlatformFeeCents,
            restaurant.OneTimePlatformFeeStatus
        };
        var nextBasisPoints = (int)decimal.Round(
            request.OrderPlatformFeePercent * 100m,
            0,
            MidpointRounding.AwayFromZero);
        var setupFeeChanged = restaurant.OneTimePlatformFeeCents != request.OneTimePlatformFeeCents;

        restaurant.OrderPlatformFeeBps = nextBasisPoints;
        restaurant.OneTimePlatformFeeCents = request.OneTimePlatformFeeCents;
        if (!restaurant.OneTimePlatformFeePaidAt.HasValue && setupFeeChanged)
        {
            restaurant.OneTimePlatformFeeStatus = request.OneTimePlatformFeeCents == 0
                ? PlatformSetupFeeStatus.NotRequired
                : PlatformSetupFeeStatus.Pending;
            restaurant.OneTimePlatformFeeCheckoutSessionId = null;
            restaurant.OneTimePlatformFeePaymentIntentId = null;
            restaurant.OneTimePlatformFeeCheckoutUrl = null;
            restaurant.OneTimePlatformFeeIdempotencyKey = null;
        }

        restaurant.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "Restaurant.PaymentSettingsUpdated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Updated Stripe platform fees for {restaurant.Name}.",
            before,
            new
            {
                restaurant.OrderPlatformFeeBps,
                restaurant.OneTimePlatformFeeCents,
                restaurant.OneTimePlatformFeeStatus
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(MapPaymentSettings(restaurant));
    }

    [HttpPost("{id:guid}/stripe/connect-link")]
    public async Task<ActionResult<StripeActionLinkResponse>> CreateStripeConnectLink(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe is not configured."
            });
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        try
        {
            if (string.IsNullOrWhiteSpace(restaurant.StripeAccountId))
            {
                var contactEmail = await ResolveRestaurantOwnerEmailAsync(id, cancellationToken);
                var accountOptions = new AccountCreateOptions
                {
                    Country = restaurant.CountryCode,
                    DefaultCurrency = restaurant.Currency.ToLowerInvariant(),
                    Email = contactEmail,
                    BusinessProfile = StripeConnectPrefillBuilder.Build(
                        restaurant,
                        contactEmail),
                    Controller = new AccountControllerOptions
                    {
                        Fees = new AccountControllerFeesOptions { Payer = "account" },
                        Losses = new AccountControllerLossesOptions { Payments = "stripe" },
                        RequirementCollection = "stripe",
                        StripeDashboard = new AccountControllerStripeDashboardOptions { Type = "full" }
                    },
                    Metadata = new Dictionary<string, string>
                    {
                        ["restaurantId"] = restaurant.Id.ToString(),
                        ["restaurantName"] = restaurant.Name
                    }
                };
                var accountService = new AccountService(_stripeClient);
                var account = await accountService.CreateAsync(
                    accountOptions,
                    new RequestOptions
                    {
                        IdempotencyKey = StripeConnectIdempotency.BuildAccountCreationKey(restaurant.Id, DateTime.UtcNow)
                    },
                    cancellationToken);

                restaurant.StripeAccountId = account.Id;
                restaurant.StripeConnectedAt = DateTime.UtcNow;
                ApplyStripeAccountState(restaurant, account);
                _reportLogWriter.AddAudit(
                    "Restaurant.StripeAccountCreated",
                    "Restaurant",
                    restaurant.Id.ToString(),
                    restaurant.Id,
                    $"Created Stripe connected account for {restaurant.Name}.",
                    after: new
                    {
                        restaurant.StripeAccountId,
                        account.Controller?.Fees?.Payer,
                        losses = account.Controller?.Losses?.Payments,
                        dashboard = account.Controller?.StripeDashboard?.Type
                    });
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            var linkService = new AccountLinkService(_stripeClient);
            var accountLink = await linkService.CreateAsync(
                new AccountLinkCreateOptions
                {
                    Account = restaurant.StripeAccountId,
                    RefreshUrl = AddRestaurantId(_stripeOptions.ConnectRefreshUrl, restaurant.Id),
                    ReturnUrl = AddRestaurantId(_stripeOptions.ConnectReturnUrl, restaurant.Id),
                    Type = "account_onboarding"
                },
                cancellationToken: cancellationToken);

            return Ok(new StripeActionLinkResponse
            {
                Message = restaurant.StripeDetailsSubmitted
                    ? "Stripe account update link created."
                    : "Stripe onboarding link created.",
                Url = accountLink.Url,
                StripeAccountId = restaurant.StripeAccountId,
                ExpiresAt = accountLink.ExpiresAt
            });
        }
        catch (StripeException exception)
        {
            var providerMessage = exception.StripeError?.Message ?? exception.Message;
            var connectSetupIncomplete = providerMessage.Contains(
                "signed up for Connect",
                StringComparison.OrdinalIgnoreCase);

            _logger.LogWarning(
                exception,
                "Stripe rejected onboarding for restaurant {RestaurantId}. Error code: {StripeErrorCode}.",
                restaurant.Id,
                exception.StripeError?.Code);

            return StatusCode(
                connectSetupIncomplete
                    ? StatusCodes.Status409Conflict
                    : StatusCodes.Status502BadGateway,
                new
                {
                    message = connectSetupIncomplete
                        ? "Stripe Connect platform setup is incomplete. Finish the business information section in the Stripe Connect setup guide, then try again."
                        : "Stripe could not start restaurant onboarding. Please try again.",
                    code = connectSetupIncomplete
                        ? "stripe_connect_setup_incomplete"
                        : "stripe_onboarding_failed"
                });
        }
    }

    [HttpPost("{id:guid}/stripe/refresh")]
    public async Task<ActionResult<RestaurantPaymentSettingsResponse>> RefreshStripeStatus(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe is not configured."
            });
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (string.IsNullOrWhiteSpace(restaurant.StripeAccountId))
        {
            return Conflict(new { message = "This restaurant has not connected Stripe." });
        }

        var accountService = new AccountService(_stripeClient);
        var account = await accountService.GetAsync(
            restaurant.StripeAccountId,
            cancellationToken: cancellationToken);
        ApplyStripeAccountState(restaurant, account);
        restaurant.UpdatedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(MapPaymentSettings(restaurant));
    }

    [HttpPost("{id:guid}/stripe/diagnostics")]
    public async Task<ActionResult<StripeConnectDiagnosticResponse>> RunStripeDiagnostics(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (!_stripeOptions.SecretKey.StartsWith("sk_test_", StringComparison.Ordinal))
        {
            return Conflict(new
            {
                message = "Stripe diagnostics are only available with a Stripe test-mode key."
            });
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (string.IsNullOrWhiteSpace(restaurant.StripeAccountId))
        {
            return Conflict(new { message = "Connect this restaurant to Stripe before running diagnostics." });
        }

        try
        {
            var accountService = new AccountService(_stripeClient);
            var account = await accountService.GetAsync(
                restaurant.StripeAccountId,
                cancellationToken: cancellationToken);
            ApplyStripeAccountState(restaurant, account);
            restaurant.UpdatedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);

            var snapshot = StripeConnectAccountState.Read(restaurant.StripeRequirementsDueJson);
            return Ok(new StripeConnectDiagnosticResponse
            {
                Mode = "Test",
                CheckedAt = DateTime.UtcNow,
                Settings = MapPaymentSettings(restaurant),
                Checks = StripeConnectAccountState.BuildDiagnosticChecks(restaurant, snapshot)
            });
        }
        catch (StripeException exception)
        {
            _logger.LogWarning(
                exception,
                "Stripe diagnostics failed for restaurant {RestaurantId} and account {StripeAccountId}.",
                restaurant.Id,
                restaurant.StripeAccountId);
            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                message = "Stripe could not retrieve this connected account.",
                code = exception.StripeError?.Code ?? "stripe_account_unreachable"
            });
        }
    }

    [HttpPost("{id:guid}/platform-fee/checkout")]
    public async Task<ActionResult<PlatformFeeCheckoutResponse>> CreatePlatformFeeCheckout(
        Guid id,
        CancellationToken cancellationToken)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(_stripeOptions.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Stripe is not configured."
            });
        }

        var restaurant = await _dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (restaurant.OneTimePlatformFeeCents == 0)
        {
            restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.NotRequired;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new PlatformFeeCheckoutResponse
            {
                Message = "No one-time platform fee is configured.",
                Required = false,
                Paid = true
            });
        }

        if (restaurant.OneTimePlatformFeePaidAt.HasValue)
        {
            return Ok(new PlatformFeeCheckoutResponse
            {
                Message = "The one-time platform fee has already been paid.",
                Required = true,
                Paid = true,
                SessionId = restaurant.OneTimePlatformFeeCheckoutSessionId
            });
        }

        if (restaurant.OneTimePlatformFeeStatus == PlatformSetupFeeStatus.Pending &&
            !string.IsNullOrWhiteSpace(restaurant.OneTimePlatformFeeCheckoutSessionId) &&
            !string.IsNullOrWhiteSpace(restaurant.OneTimePlatformFeeCheckoutUrl))
        {
            return Ok(new PlatformFeeCheckoutResponse
            {
                Message = "Existing platform fee checkout reused.",
                Required = true,
                Paid = false,
                CheckoutUrl = restaurant.OneTimePlatformFeeCheckoutUrl,
                SessionId = restaurant.OneTimePlatformFeeCheckoutSessionId
            });
        }

        var feeConfigurationVersion = (restaurant.UpdatedAt ?? restaurant.CreatedAt).Ticks;
        restaurant.OneTimePlatformFeeIdempotencyKey =
            $"restaurant-platform-fee-{restaurant.Id:N}-{restaurant.OneTimePlatformFeeCents}-{feeConfigurationVersion}";
        var metadata = new Dictionary<string, string>
        {
            ["mode"] = "restaurant_platform_setup_fee",
            ["restaurantId"] = restaurant.Id.ToString(),
            ["amountCents"] = restaurant.OneTimePlatformFeeCents.ToString(CultureInfo.InvariantCulture)
        };
        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AppendSessionId(AddRestaurantId(_stripeOptions.PlatformFeeSuccessUrl, restaurant.Id)),
            CancelUrl = AddRestaurantId(_stripeOptions.PlatformFeeCancelUrl, restaurant.Id),
            CustomerEmail = await ResolveRestaurantOwnerEmailAsync(id, cancellationToken),
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Quantity = 1,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = restaurant.Currency.ToLowerInvariant(),
                        UnitAmount = restaurant.OneTimePlatformFeeCents,
                        ProductData = new SessionLineItemPriceDataProductDataOptions
                        {
                            Name = "DineFlow one-time platform activation"
                        }
                    }
                }
            ],
            Metadata = metadata,
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                Metadata = metadata
            }
        };
        var sessionService = new SessionService(_stripeClient);
        var session = await sessionService.CreateAsync(
            sessionOptions,
            new RequestOptions { IdempotencyKey = restaurant.OneTimePlatformFeeIdempotencyKey },
            cancellationToken);

        restaurant.OneTimePlatformFeeStatus = PlatformSetupFeeStatus.Pending;
        restaurant.OneTimePlatformFeeCheckoutSessionId = session.Id;
        restaurant.OneTimePlatformFeePaymentIntentId = session.PaymentIntentId;
        restaurant.OneTimePlatformFeeCheckoutUrl = session.Url;
        restaurant.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "Restaurant.PlatformFeeCheckoutCreated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Created one-time platform fee checkout for {restaurant.Name}.",
            after: new
            {
                sessionId = session.Id,
                restaurant.OneTimePlatformFeeCents,
                restaurant.Currency
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new PlatformFeeCheckoutResponse
        {
            Message = "Platform fee checkout created.",
            Required = true,
            Paid = false,
            CheckoutUrl = session.Url,
            SessionId = session.Id
        });
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPost]
    public async Task<IActionResult> CreateRestaurant([FromBody] RestaurantRequest request)
    {
        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        if (!_restaurantOperatingHoursService.TryNormalizeOpeningHoursJson(
            request.OpeningHoursJson,
            out var openingHoursJson,
            out var openingHoursError))
        {
            return BadRequest(new { message = openingHoursError });
        }

        if (!_restaurantOperatingHoursService.TryNormalizeSpecialOpeningDaysJson(
            request.SpecialOpeningDaysJson,
            out var specialOpeningDaysJson,
            out var specialOpeningDaysError))
        {
            return BadRequest(new { message = specialOpeningDaysError });
        }

        var restaurant = new Restaurant
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Address = request.Address.Trim(),
            Phone = request.Phone.Trim(),
            ImageUrl = NormalizeOptionalValue(request.ImageUrl),
            CountryCode = NormalizeCountryCode(request.CountryCode),
            Timezone = request.Timezone.Trim(),
            Currency = request.Currency.Trim().ToUpperInvariant(),
            PaymentPolicy = Enum.Parse<RestaurantPaymentPolicy>(request.PaymentPolicy, true),
            IsActive = request.IsActive,
            AcceptingOrders = request.AcceptingOrders,
            OpeningHoursJson = openingHoursJson,
            SpecialOpeningDaysJson = specialOpeningDaysJson,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = null
        };

        await _dbContext.Restaurants.AddAsync(restaurant);
        _reportLogWriter.AddAudit(
            "Restaurant.Created",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Created restaurant {restaurant.Name}.",
            after: SnapshotRestaurant(restaurant));
        await _dbContext.SaveChangesAsync();

        var response = MapToResponse(restaurant);
        return CreatedAtAction(nameof(GetRestaurant), new { id = restaurant.Id }, response);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateRestaurant(Guid id, [FromBody] RestaurantRequest request)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        if (!_restaurantOperatingHoursService.TryNormalizeOpeningHoursJson(
            request.OpeningHoursJson,
            out var openingHoursJson,
            out var openingHoursError))
        {
            return BadRequest(new { message = openingHoursError });
        }

        if (!_restaurantOperatingHoursService.TryNormalizeSpecialOpeningDaysJson(
            request.SpecialOpeningDaysJson,
            out var specialOpeningDaysJson,
            out var specialOpeningDaysError))
        {
            return BadRequest(new { message = specialOpeningDaysError });
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var beforeRestaurant = SnapshotRestaurant(restaurant);

        restaurant.Name = request.Name.Trim();
        restaurant.Address = request.Address.Trim();
        restaurant.Phone = request.Phone.Trim();
        restaurant.ImageUrl = NormalizeOptionalValue(request.ImageUrl);
        restaurant.CountryCode = NormalizeCountryCode(request.CountryCode);
        restaurant.Timezone = request.Timezone.Trim();
        restaurant.Currency = request.Currency.Trim().ToUpperInvariant();
        restaurant.PaymentPolicy = Enum.Parse<RestaurantPaymentPolicy>(request.PaymentPolicy, true);
        restaurant.IsActive = request.IsActive;
        restaurant.AcceptingOrders = request.AcceptingOrders;
        if (request.AcceptingOrders)
        {
            // Otherwise a stale expiry would linger and re-pause logic would read inconsistently.
            restaurant.AcceptingOrdersPausedUntil = null;
        }

        restaurant.OpeningHoursJson = openingHoursJson;
        restaurant.SpecialOpeningDaysJson = specialOpeningDaysJson;
        restaurant.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "Restaurant.Updated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Updated restaurant {restaurant.Name}.",
            beforeRestaurant,
            SnapshotRestaurant(restaurant));
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Restaurant updated successfully.",
            restaurant = MapToResponse(restaurant)
        });
    }

    [HttpPatch("{id:guid}/ordering-status")]
    public async Task<IActionResult> UpdateOrderingStatus(
        Guid id,
        [FromBody] RestaurantOrderingStatusRequest request)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (request.PauseMinutes is <= 0 or > MaximumPauseMinutes)
        {
            return BadRequest(new
            {
                message = $"pauseMinutes must be between 1 and {MaximumPauseMinutes}."
            });
        }

        var now = DateTime.UtcNow;
        var beforeRestaurant = SnapshotRestaurant(restaurant);
        var pausedUntil = ResolvePauseExpiry(restaurant, request, now);

        if (!request.AcceptingOrders && request.PauseUntilNextOpening && pausedUntil is null)
        {
            return Conflict(new
            {
                message = "The schedule has no upcoming opening to reopen at. Choose a duration, or close until you reopen."
            });
        }

        restaurant.AcceptingOrders = request.AcceptingOrders;
        // A resume always clears the expiry; a pause only carries one when one was requested.
        restaurant.AcceptingOrdersPausedUntil = pausedUntil;
        restaurant.UpdatedAt = now;

        _reportLogWriter.AddAudit(
            request.AcceptingOrders ? "Restaurant.OrderingResumed" : "Restaurant.OrderingPaused",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            request.AcceptingOrders
                ? $"Resumed ordering for {restaurant.Name}."
                : restaurant.AcceptingOrdersPausedUntil.HasValue
                    ? $"Paused ordering for {restaurant.Name} for {request.PauseMinutes} minutes."
                    : $"Paused ordering for {restaurant.Name}.",
            beforeRestaurant,
            SnapshotRestaurant(restaurant));
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = request.AcceptingOrders
                ? "Restaurant is open for orders."
                : !restaurant.AcceptingOrdersPausedUntil.HasValue
                    ? "Restaurant is closed until you reopen it."
                    : request.PauseUntilNextOpening
                        ? "Restaurant is closed and reopens at the next opening."
                        : $"Restaurant is closed for {request.PauseMinutes} minutes.",
            restaurant = MapToResponse(restaurant)
        });
    }

    [HttpPut("{id:guid}/opening-hours")]
    public async Task<IActionResult> UpdateOpeningHours(
        Guid id,
        [FromBody] RestaurantOpeningHoursRequest request)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (!_restaurantOperatingHoursService.TryNormalizeOpeningHoursJson(
            request.OpeningHoursJson,
            out var openingHoursJson,
            out var openingHoursError))
        {
            return BadRequest(new { message = openingHoursError });
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var beforeRestaurant = SnapshotRestaurant(restaurant);
        restaurant.OpeningHoursJson = openingHoursJson;
        restaurant.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "Restaurant.OpeningHoursUpdated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Updated opening hours for {restaurant.Name}.",
            beforeRestaurant,
            SnapshotRestaurant(restaurant));
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Opening hours updated successfully.",
            restaurant = MapToResponse(restaurant)
        });
    }

    [HttpPut("{id:guid}/special-days")]
    public async Task<IActionResult> UpdateSpecialOpeningDays(
        Guid id,
        [FromBody] RestaurantSpecialOpeningDaysRequest request)
    {
        if (!await CanAccessRestaurantAsync(id))
        {
            return Forbid();
        }

        if (!_restaurantOperatingHoursService.TryNormalizeSpecialOpeningDaysJson(
            request.SpecialOpeningDaysJson,
            out var specialOpeningDaysJson,
            out var specialOpeningDaysError))
        {
            return BadRequest(new { message = specialOpeningDaysError });
        }

        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var beforeRestaurant = SnapshotRestaurant(restaurant);
        restaurant.SpecialOpeningDaysJson = specialOpeningDaysJson;
        restaurant.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "Restaurant.SpecialOpeningDaysUpdated",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Updated the special calendar for {restaurant.Name}.",
            beforeRestaurant,
            SnapshotRestaurant(restaurant));
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Special calendar updated successfully.",
            restaurant = MapToResponse(restaurant)
        });
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteRestaurant(Guid id)
    {
        var restaurant = await _dbContext.Restaurants.FirstOrDefaultAsync(r => r.Id == id);

        if (restaurant is null)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var deletedRestaurant = SnapshotRestaurant(restaurant);
        _dbContext.Restaurants.Remove(restaurant);
        _reportLogWriter.AddAudit(
            "Restaurant.Deleted",
            "Restaurant",
            restaurant.Id.ToString(),
            restaurant.Id,
            $"Deleted restaurant {restaurant.Name}.",
            deletedRestaurant);
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Restaurant deleted successfully.",
            restaurantId = id
        });
    }

    private async Task<Guid?> GetCurrentRestaurantIdAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return null;
        }

        var currentUser = await _userManager.FindByIdAsync(currentUserId);
        return currentUser?.RestaurantId;
    }

    private async Task<bool> CanAccessRestaurantAsync(Guid restaurantId)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return true;
        }

        return await GetCurrentRestaurantIdAsync() == restaurantId;
    }

    private static string? ValidateRequest(RestaurantRequest? request)
    {
        if (request is null)
        {
            return "Restaurant data is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return "Restaurant name is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Address))
        {
            return "Restaurant address is required.";
        }

        if (string.IsNullOrWhiteSpace(request.Phone))
        {
            return "Restaurant phone is required.";
        }

        var imageUrl = NormalizeOptionalValue(request.ImageUrl);
        if (imageUrl is not null)
        {
            if (imageUrl.Length > MaximumImageUrlLength)
            {
                return $"Image URL must not exceed {MaximumImageUrlLength} characters.";
            }

            if (!IsValidImageUrl(imageUrl))
            {
                return "ImageUrl must be an absolute http(s) URL or an app-relative path starting with '/'.";
            }
        }

        var countryCode = NormalizeCountryCode(request.CountryCode);
        if (!IsValidCountryCode(countryCode))
        {
            return "CountryCode must be a valid ISO 3166-1 alpha-2 country code.";
        }

        var timezone = request.Timezone?.Trim();
        if (string.IsNullOrWhiteSpace(timezone) || !IsValidTimezone(timezone))
        {
            return "Timezone must be a valid IANA timezone.";
        }

        var currency = request.Currency?.Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(currency) ||
            currency.Length != 3 ||
            !IsoCurrencyCodes.Contains(currency))
        {
            return "Currency must be a valid three-letter ISO 4217 code.";
        }

        if (!Enum.TryParse<RestaurantPaymentPolicy>(request.PaymentPolicy, true, out var paymentPolicy) ||
            !Enum.IsDefined(paymentPolicy))
        {
            return $"PaymentPolicy must be one of: {string.Join(", ", Enum.GetNames<RestaurantPaymentPolicy>())}.";
        }

        return null;
    }

    private RestaurantResponse MapToResponse(Restaurant restaurant)
    {
        return new RestaurantResponse
        {
            Id = restaurant.Id,
            Name = restaurant.Name,
            Address = restaurant.Address,
            Phone = restaurant.Phone,
            ImageUrl = restaurant.ImageUrl,
            CountryCode = restaurant.CountryCode,
            Timezone = restaurant.Timezone,
            Currency = restaurant.Currency,
            PaymentPolicy = restaurant.PaymentPolicy.ToString(),
            StripeConnectStatus = GetStripeConnectStatus(restaurant),
            OnlinePaymentsEnabled = restaurant.StripeChargesEnabled &&
                !string.IsNullOrWhiteSpace(restaurant.StripeAccountId),
            OrderPlatformFeePercent = restaurant.OrderPlatformFeeBps / 100m,
            OneTimePlatformFeeCents = restaurant.OneTimePlatformFeeCents,
            OneTimePlatformFeeStatus = restaurant.OneTimePlatformFeeStatus.ToString(),
            IsActive = restaurant.IsActive,
            AcceptingOrders = restaurant.AcceptingOrders,
            AcceptingOrdersPausedUntil = restaurant.AcceptingOrdersPausedUntil,
            AutoAcceptOrders = restaurant.AutoAcceptOrders,
            OpeningHoursJson = restaurant.OpeningHoursJson,
            SpecialOpeningDaysJson = restaurant.SpecialOpeningDaysJson,
            Availability = BuildAvailabilityResponse(restaurant),
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        };
    }

    /// <summary>
    /// The UTC instant a pause should lapse, or null for an indefinite pause (and always null when
    /// resuming, so a stale expiry can't linger).
    /// </summary>
    private DateTime? ResolvePauseExpiry(Restaurant restaurant, RestaurantOrderingStatusRequest request, DateTime now)
    {
        if (request.AcceptingOrders)
        {
            return null;
        }

        if (request.PauseUntilNextOpening)
        {
            return _restaurantOperatingHoursService.GetNextOpeningUtc(restaurant, now);
        }

        return request.PauseMinutes is null ? null : now.AddMinutes(request.PauseMinutes.Value);
    }

    private RestaurantAvailabilityResponse BuildAvailabilityResponse(Restaurant restaurant)
    {
        var utcNow = DateTime.UtcNow;
        var availability = _restaurantOperatingHoursService.GetAvailability(restaurant, utcNow);

        return new RestaurantAvailabilityResponse
        {
            IsOrderingAvailable = availability.IsOrderingAvailable,
            IsWithinOpeningHours = availability.IsWithinOpeningHours,
            AcceptingOrders = availability.AcceptingOrders,
            Reason = availability.Reason,
            Message = availability.Message,
            NextTransitionLocal = availability.NextTransitionLocal,
            NextOpeningLocal = availability.NextOpeningLocal,
            LocalNow = RestaurantOperatingHoursService.GetLocalNow(restaurant, utcNow),
            PausedUntilUtc = availability.PausedUntilUtc
        };
    }

    private static object SnapshotRestaurant(Restaurant restaurant) => new
    {
        restaurant.Id,
        restaurant.Name,
        restaurant.Address,
        restaurant.Phone,
        restaurant.ImageUrl,
        restaurant.CountryCode,
        restaurant.Timezone,
        restaurant.Currency,
        PaymentPolicy = restaurant.PaymentPolicy.ToString(),
        restaurant.IsActive,
        restaurant.AcceptingOrders,
        restaurant.AutoAcceptOrders,
        restaurant.OpeningHoursJson,
        restaurant.SpecialOpeningDaysJson
    };

    private RestaurantPaymentSettingsResponse MapPaymentSettings(Restaurant restaurant)
    {
        var snapshot = StripeConnectAccountState.Read(restaurant.StripeRequirementsDueJson);

        return new RestaurantPaymentSettingsResponse
        {
            RestaurantId = restaurant.Id,
            RestaurantName = restaurant.Name,
            Currency = restaurant.Currency,
            StripeAccountId = restaurant.StripeAccountId,
            StripeConnectStatus = GetStripeConnectStatus(restaurant),
            StripeDetailsSubmitted = restaurant.StripeDetailsSubmitted,
            StripeChargesEnabled = restaurant.StripeChargesEnabled,
            StripePayoutsEnabled = restaurant.StripePayoutsEnabled,
            StripeRequirementsDue = StripeConnectAccountState.GetActionableRequirements(snapshot),
            StripeRestrictions = StripeConnectAccountState.BuildRestrictions(
                snapshot,
                restaurant.StripeDetailsSubmitted,
                restaurant.StripeChargesEnabled,
                restaurant.StripePayoutsEnabled),
            StripeCurrentDeadline = snapshot.CurrentDeadline,
            StripeConnectedAt = restaurant.StripeConnectedAt,
            StripeAccountUpdatedAt = restaurant.StripeAccountUpdatedAt,
            OrderPlatformFeePercent = restaurant.OrderPlatformFeeBps / 100m,
            OneTimePlatformFeeCents = restaurant.OneTimePlatformFeeCents,
            OneTimePlatformFeeStatus = restaurant.OneTimePlatformFeeStatus.ToString(),
            OneTimePlatformFeePaidAt = restaurant.OneTimePlatformFeePaidAt,
            OnlinePaymentsEnabled = restaurant.StripeChargesEnabled &&
                !string.IsNullOrWhiteSpace(restaurant.StripeAccountId)
        };
    }

    private static string GetStripeConnectStatus(Restaurant restaurant)
    {
        if (string.IsNullOrWhiteSpace(restaurant.StripeAccountId))
        {
            return "NotConnected";
        }

        if (restaurant.StripeChargesEnabled && restaurant.StripePayoutsEnabled)
        {
            return "Ready";
        }

        return restaurant.StripeDetailsSubmitted ? "Restricted" : "OnboardingIncomplete";
    }

    private static void ApplyStripeAccountState(Restaurant restaurant, Account account) =>
        StripeConnectAccountState.Apply(restaurant, account);

    private async Task<string?> ResolveRestaurantOwnerEmailAsync(
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        var currentEmail = User.FindFirstValue(ClaimTypes.Email);
        if (!string.IsNullOrWhiteSpace(currentEmail) &&
            !User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return currentEmail;
        }

        return await _dbContext.Users
            .Where(user => user.RestaurantId == restaurantId && user.Email != null)
            .OrderBy(user => user.CreatedAt)
            .Select(user => user.Email)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private static string AddRestaurantId(string url, Guid restaurantId) =>
        QueryHelpers.AddQueryString(url, "restaurantId", restaurantId.ToString());

    private static string AppendSessionId(string url) =>
        QueryHelpers.AddQueryString(url, "session_id", "{CHECKOUT_SESSION_ID}");

    private static string NormalizeCountryCode(string? countryCode)
    {
        countryCode = countryCode?.Trim().ToUpperInvariant();
        return string.IsNullOrWhiteSpace(countryCode) ? "AU" : countryCode;
    }

    private static string? NormalizeOptionalValue(string? value)
    {
        value = value?.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static bool IsValidImageUrl(string imageUrl)
    {
        if (imageUrl.StartsWith("/", StringComparison.Ordinal))
        {
            return true;
        }

        return Uri.TryCreate(imageUrl, UriKind.Absolute, out var uri) &&
            (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }

    private static bool IsValidCountryCode(string countryCode)
    {
        if (countryCode.Length != 2)
        {
            return false;
        }

        try
        {
            _ = new RegionInfo(countryCode);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static bool IsValidTimezone(string timezone)
    {
        if (TimeZoneInfo.TryConvertIanaIdToWindowsId(timezone, out _))
        {
            return true;
        }

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timezone);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }
    }
}
