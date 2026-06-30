using System.Security.Claims;
using System.Globalization;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Extensions;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class RestaurantController : ControllerBase
{
    private const int MaximumImageUrlLength = 2_048;

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

    public RestaurantController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _reportLogWriter = reportLogWriter;
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
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
        });
        var page = await responseQuery.ToPagedResponseAsync(request.Page, request.PageSize, cancellationToken);

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

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPost]
    public async Task<IActionResult> CreateRestaurant([FromBody] RestaurantRequest request)
    {
        var validationError = ValidateRequest(request);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
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

    private static RestaurantResponse MapToResponse(Restaurant restaurant)
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
            IsActive = restaurant.IsActive,
            CreatedAt = restaurant.CreatedAt,
            UpdatedAt = restaurant.UpdatedAt
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
        restaurant.IsActive
    };

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
