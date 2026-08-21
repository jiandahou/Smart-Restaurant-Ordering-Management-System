using Amazon.S3;
using Amazon.S3.Model;
using System.Linq.Expressions;
using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Menu;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/admin/menu/items")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class AdminMenuItemsController : ControllerBase
{
    private const int MaximumNameLength = 150;
    private const int MaximumDescriptionLength = 1_000;
    private const int MaximumImageUrlLength = 2_048;
    private const int MaximumDisplayOrder = 10_000;
    private const decimal MaximumPrice = 1_000_000m;
    private const long MaximumImageBytes = 8 * 1024 * 1024;
    private static readonly IReadOnlyDictionary<string, string> AllowedImageExtensionsByContentType =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = ".jpg",
            ["image/png"] = ".png",
            ["image/webp"] = ".webp"
        };

    private readonly AppDbContext _dbContext;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AvatarStorageOptions _storageOptions;
    private readonly IAmazonS3 _s3Client;
    private readonly ILogger<AdminMenuItemsController> _logger;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly StoredImageVerifier _storedImageVerifier;

    public AdminMenuItemsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IOptions<AvatarStorageOptions> storageOptions,
        IAmazonS3 s3Client,
        ILogger<AdminMenuItemsController> logger,
        ReportLogWriter reportLogWriter,
        StoredImageVerifier storedImageVerifier)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _storageOptions = storageOptions.Value;
        _s3Client = s3Client;
        _logger = logger;
        _reportLogWriter = reportLogWriter;
        _storedImageVerifier = storedImageVerifier;
    }

    [HttpPost("image-upload-url")]
    public async Task<IActionResult> CreateImageUploadUrl(
        [FromBody] CreateMenuItemImageUploadUrlRequest request,
        CancellationToken cancellationToken)
    {
        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "Restaurant is required." });
        }

        if (!await CanAccessRestaurantAsync(request.RestaurantId))
        {
            return Forbid();
        }

        if (!await _dbContext.Restaurants
                .AsNoTracking()
                .AnyAsync(restaurant => restaurant.Id == request.RestaurantId, cancellationToken))
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        if (!IsS3StorageEnabled())
        {
            return BadRequest(new { message = "Presigned menu image uploads are not enabled." });
        }

        if (request.FileSize <= 0 || request.FileSize > MaximumImageBytes)
        {
            return BadRequest(new { message = "Menu image must be 8MB or smaller." });
        }

        if (!AllowedImageExtensionsByContentType.TryGetValue(request.ContentType, out var extension))
        {
            return BadRequest(new { message = "Menu image must be a JPG, PNG, or WebP file." });
        }

        var objectKey = $"uploads/menu-items/{request.RestaurantId}/{Guid.NewGuid():N}{extension}";
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(Math.Max(1, _storageOptions.UploadUrlExpirationMinutes));
        var presignedRequest = new GetPreSignedUrlRequest
        {
            BucketName = _storageOptions.Bucket,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Expires = expiresAt.UtcDateTime,
            ContentType = request.ContentType
        };

        try
        {
            var uploadUrl = RewriteUploadUrlForClient(await _s3Client.GetPreSignedURLAsync(presignedRequest));

            return Ok(new CreateMenuItemImageUploadUrlResponse
            {
                UploadUrl = uploadUrl,
                ObjectKey = objectKey,
                ImageUrl = BuildPublicImageUrl(objectKey),
                ExpiresAt = expiresAt,
                Headers = new Dictionary<string, string>
                {
                    ["Content-Type"] = request.ContentType
                }
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create a menu image upload URL for bucket {Bucket}.", _storageOptions.Bucket);

            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                message = "Failed to create menu image upload URL. Check storage credentials and bucket configuration."
            });
        }
    }

    [HttpPost("image-upload-complete")]
    public async Task<IActionResult> CompleteImageUpload(
        [FromBody] CompleteMenuItemImageUploadRequest request,
        CancellationToken cancellationToken)
    {
        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "Restaurant is required." });
        }

        if (!await CanAccessRestaurantAsync(request.RestaurantId))
        {
            return Forbid();
        }

        if (!IsS3StorageEnabled())
        {
            return BadRequest(new { message = "Presigned menu image uploads are not enabled." });
        }

        var objectKey = request.ObjectKey?.Trim();
        var ownedPrefix = $"uploads/menu-items/{request.RestaurantId}/";

        if (string.IsNullOrWhiteSpace(objectKey) ||
            !objectKey.StartsWith(ownedPrefix, StringComparison.Ordinal))
        {
            return BadRequest(new { message = "Invalid menu image upload key." });
        }

        GetObjectMetadataResponse metadata;

        try
        {
            metadata = await _s3Client.GetObjectMetadataAsync(_storageOptions.Bucket, objectKey, cancellationToken);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return BadRequest(new { message = "Uploaded menu image was not found." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to inspect uploaded menu image {ObjectKey}.", objectKey);
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "Could not verify the uploaded menu image." });
        }

        if (metadata.Headers.ContentLength <= 0 || metadata.Headers.ContentLength > MaximumImageBytes)
        {
            return BadRequest(new { message = "Uploaded menu image is invalid." });
        }

        if (!AllowedImageExtensionsByContentType.ContainsKey(metadata.Headers.ContentType))
        {
            return BadRequest(new { message = "Uploaded menu image must be a JPG, PNG, or WebP file." });
        }

        // The upload went straight to the bucket, so this is the first sight of the bytes. Both the
        // content type and the extension were chosen by the uploader and prove nothing.
        if (!await _storedImageVerifier.IsDeclaredImageAsync(
                _storageOptions.Bucket,
                objectKey,
                metadata.Headers.ContentType,
                cancellationToken))
        {
            await _storedImageVerifier.DeleteAsync(_storageOptions.Bucket, objectKey, cancellationToken);

            return BadRequest(new { message = "Uploaded menu image must be a JPG, PNG, or WebP file." });
        }

        return Ok(new CompleteMenuItemImageUploadResponse
        {
            ObjectKey = objectKey,
            ImageUrl = BuildPublicImageUrl(objectKey)
        });
    }

    [HttpGet]
    public async Task<IActionResult> GetItems(
        [FromQuery] Guid restaurantId,
        [FromQuery] Guid? categoryId,
        CancellationToken cancellationToken)
    {
        if (restaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "restaurantId is required." });
        }

        if (!await CanAccessRestaurantAsync(restaurantId))
        {
            return Forbid();
        }

        var restaurantExists = await _dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(restaurant => restaurant.Id == restaurantId, cancellationToken);

        if (!restaurantExists)
        {
            return NotFound(new { message = "Restaurant not found." });
        }

        var query = _dbContext.MenuItems
            .AsNoTracking()
            .Where(item => item.RestaurantId == restaurantId);

        if (categoryId.HasValue && categoryId.Value != Guid.Empty)
        {
            query = query.Where(item => item.CategoryId == categoryId.Value);
        }

        var items = await query
            .OrderBy(item => item.DisplayOrder)
            .ThenBy(item => item.Name)
            .Select(ToResponse)
            .ToListAsync(cancellationToken);

        return Ok(items);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetItem(Guid id, CancellationToken cancellationToken)
    {
        var item = await FindItemResponseAsync(id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        return Ok(item);
    }

    [HttpPost]
    public async Task<IActionResult> CreateItem(
        [FromBody] CreateMenuItemRequest request,
        CancellationToken cancellationToken)
    {
        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "Restaurant is required." });
        }

        if (!await CanAccessRestaurantAsync(request.RestaurantId))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(
            request.CategoryId,
            request.Name,
            request.Description,
            request.Price,
            request.ImageUrl,
            request.DisplayOrder,
            request.Allergens,
            request.SpiceLevel,
            request.ServingSize,
            request.Calories);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }
        if (request.MayContainAllergens?.Trim().Length > 500 || request.CrossContactStatement?.Trim().Length > 1000)
            return BadRequest(new { message = "May-contain allergens must not exceed 500 characters and cross-contact statement must not exceed 1,000 characters." });

        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(category => category.Id == request.CategoryId, cancellationToken);

        if (category is null || category.RestaurantId != request.RestaurantId)
        {
            return BadRequest(new { message = "Category does not belong to the selected restaurant." });
        }

        var priceProblem = await DescribePriceProblemAsync(
            request.RestaurantId,
            request.Price,
            cancellationToken);

        if (priceProblem is not null)
        {
            return BadRequest(new { message = priceProblem, code = "price_precision" });
        }

        var name = request.Name.Trim();

        if (await ItemNameExistsAsync(request.CategoryId, name, null, cancellationToken))
        {
            return Conflict(new { message = "An item with this name already exists in the category." });
        }

        // A gluten-free claim beside an allergen list that says "wheat" is either a typo or a
        // dangerous mistake, and only the person in front of the menu can tell which.
        var dietaryConflicts = DietaryClaimConflicts.Find(
            request.IsGlutenFree,
            request.IsVegan,
            request.IsVegetarian,
            request.IsHalal,
            NormalizeOptionalValue(request.Allergens),
            NormalizeOptionalValue(request.MayContainAllergens));

        if (dietaryConflicts.Count > 0 && !request.AcknowledgeDietaryConflicts)
        {
            return Conflict(new
            {
                message = "The dietary labels contradict the allergen information for this item.",
                code = "dietary_conflict",
                conflicts = dietaryConflicts
            });
        }

        var item = new MenuItem
        {
            Id = Guid.NewGuid(),
            RestaurantId = request.RestaurantId,
            CategoryId = request.CategoryId,
            Name = name,
            Description = NormalizeOptionalValue(request.Description),
            Price = request.Price,
            ImageUrl = NormalizeOptionalValue(request.ImageUrl),
            IsAvailable = request.IsAvailable,
            IsSoldOut = request.IsSoldOut,
            IsVegetarian = DietaryClaimConflicts.ResolveVegetarian(request.IsVegan, request.IsVegetarian),
            IsVegan = request.IsVegan,
            IsGlutenFree = request.IsGlutenFree,
            IsHalal = request.IsHalal,
            Allergens = NormalizeOptionalValue(request.Allergens),
            MayContainAllergens = NormalizeOptionalValue(request.MayContainAllergens),
            CrossContactStatement = NormalizeOptionalValue(request.CrossContactStatement),
            AllergenInfoLastVerifiedAt = ResolveAllergenVerifiedAt(
                NormalizeOptionalValue(request.Allergens),
                NormalizeOptionalValue(request.MayContainAllergens),
                NormalizeOptionalValue(request.CrossContactStatement)),
            SpiceLevel = request.SpiceLevel,
            ServingSize = NormalizeOptionalValue(request.ServingSize),
            Calories = request.Calories,
            IsPopular = request.IsPopular,
            IsRecommended = request.IsRecommended,
            DisplayOrder = request.DisplayOrder,
            CreatedAt = DateTime.UtcNow
        };

        await _dbContext.MenuItems.AddAsync(item, cancellationToken);
        _reportLogWriter.AddAudit(
            "MenuItem.Created",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            $"Created menu item {item.Name}.",
            after: SnapshotItem(item));

        if (dietaryConflicts.Count > 0)
        {
            _reportLogWriter.AddAudit(
                "MenuItem.DietaryConflictAcknowledged",
                "MenuItem",
                item.Id.ToString(),
                item.RestaurantId,
                $"Saved {item.Name} with contradicting dietary labels: {string.Join(" ", dietaryConflicts)}",
                after: SnapshotItem(item));
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = MapToResponse(item, category.Name);
        return CreatedAtAction(
            nameof(GetItem),
            new { id = item.Id },
            new
            {
                message = "Menu item created successfully.",
                item = response
            });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> UpdateItem(
        Guid id,
        [FromBody] UpdateMenuItemRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var validationError = ValidateRequest(
            request.CategoryId,
            request.Name,
            request.Description,
            request.Price,
            request.ImageUrl,
            request.DisplayOrder,
            request.Allergens,
            request.SpiceLevel,
            request.ServingSize,
            request.Calories);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }
        if (request.MayContainAllergens?.Trim().Length > 500 || request.CrossContactStatement?.Trim().Length > 1000)
            return BadRequest(new { message = "May-contain allergens must not exceed 500 characters and cross-contact statement must not exceed 1,000 characters." });

        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(menuCategory => menuCategory.Id == request.CategoryId, cancellationToken);

        if (category is null || category.RestaurantId != item.RestaurantId)
        {
            return BadRequest(new { message = "Category does not belong to the item's restaurant." });
        }

        var priceProblem = await DescribePriceProblemAsync(item.RestaurantId, request.Price, cancellationToken);

        if (priceProblem is not null)
        {
            return BadRequest(new { message = priceProblem, code = "price_precision" });
        }

        if (request.ExpectedUpdatedAt is null)
        {
            return BadRequest(new
            {
                message = "This save is missing the item version it was based on, so it cannot be "
                    + "checked against changes made by anyone else. Reload the item and try again.",
                code = "missing_expected_version"
            });
        }

        // The update carries every field, so losing this race does not cost the other person one
        // field — it silently restores all of theirs to what they were before they saved.
        if (!request.OverwriteConflict && WasChangedElsewhere(item, request.ExpectedUpdatedAt.Value))
        {
            return Conflict(new
            {
                message = "Someone else saved this item while you were editing it. Review their "
                    + "version before saving, so their changes are not undone.",
                code = "menu_item_conflict",
                currentUpdatedAt = VersionOf(item),
                item = MapToResponse(item, category.Name)
            });
        }

        var name = request.Name.Trim();

        if (await ItemNameExistsAsync(request.CategoryId, name, item.Id, cancellationToken))
        {
            return Conflict(new { message = "An item with this name already exists in the category." });
        }

        var previousImageUrl = item.ImageUrl;
        var beforeItem = SnapshotItem(item);

        item.CategoryId = request.CategoryId;
        // A gluten-free claim beside an allergen list that says "wheat" is either a typo or a
        // dangerous mistake, and only the person in front of the menu can tell which.
        var dietaryConflicts = DietaryClaimConflicts.Find(
            request.IsGlutenFree,
            request.IsVegan,
            request.IsVegetarian,
            request.IsHalal,
            NormalizeOptionalValue(request.Allergens),
            NormalizeOptionalValue(request.MayContainAllergens));

        if (dietaryConflicts.Count > 0 && !request.AcknowledgeDietaryConflicts)
        {
            return Conflict(new
            {
                message = "The dietary labels contradict the allergen information for this item.",
                code = "dietary_conflict",
                conflicts = dietaryConflicts
            });
        }

        item.Name = name;
        item.Description = NormalizeOptionalValue(request.Description);
        item.Price = request.Price;
        item.ImageUrl = NormalizeOptionalValue(request.ImageUrl);
        item.IsAvailable = request.IsAvailable;
        item.IsSoldOut = request.IsSoldOut;
        item.IsVegetarian = DietaryClaimConflicts.ResolveVegetarian(request.IsVegan, request.IsVegetarian);
        item.IsVegan = request.IsVegan;
        item.IsGlutenFree = request.IsGlutenFree;
        item.IsHalal = request.IsHalal;
        var nextAllergens = NormalizeOptionalValue(request.Allergens);
        var nextMayContainAllergens = NormalizeOptionalValue(request.MayContainAllergens);
        var nextCrossContactStatement = NormalizeOptionalValue(request.CrossContactStatement);
        item.AllergenInfoLastVerifiedAt = ResolveAllergenVerifiedAt(
            nextAllergens,
            nextMayContainAllergens,
            nextCrossContactStatement,
            item.Allergens,
            item.MayContainAllergens,
            item.CrossContactStatement,
            item.AllergenInfoLastVerifiedAt);
        item.Allergens = nextAllergens;
        item.MayContainAllergens = nextMayContainAllergens;
        item.CrossContactStatement = nextCrossContactStatement;
        item.SpiceLevel = request.SpiceLevel;
        item.ServingSize = NormalizeOptionalValue(request.ServingSize);
        item.Calories = request.Calories;
        item.IsPopular = request.IsPopular;
        item.IsRecommended = request.IsRecommended;
        item.DisplayOrder = request.DisplayOrder;
        item.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "MenuItem.Updated",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            $"Updated menu item {item.Name}.",
            beforeItem,
            SnapshotItem(item));

        if (dietaryConflicts.Count > 0)
        {
            // Someone said out loud that a contradicting label is correct; that decision needs a name
            // against it, because the item now tells customers something its own allergens deny.
            _reportLogWriter.AddAudit(
                "MenuItem.DietaryConflictAcknowledged",
                "MenuItem",
                item.Id.ToString(),
                item.RestaurantId,
                $"Saved {item.Name} with contradicting dietary labels: {string.Join(" ", dietaryConflicts)}",
                after: SnapshotItem(item));
        }
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (!string.Equals(previousImageUrl, item.ImageUrl, StringComparison.OrdinalIgnoreCase))
        {
            await DeleteManagedImageAsync(previousImageUrl, item.RestaurantId, cancellationToken);
        }

        return Ok(new
        {
            message = "Menu item updated successfully.",
            item = MapToResponse(item, category.Name)
        });
    }

    [HttpPatch("{id:guid}/availability")]
    public async Task<IActionResult> UpdateAvailability(
        Guid id,
        [FromBody] UpdateMenuItemAvailabilityRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var beforeAvailability = new { item.Id, item.Name, item.IsAvailable };
        item.IsAvailable = request.IsAvailable;
        item.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "MenuItem.AvailabilityChanged",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            request.IsAvailable ? $"{item.Name} is now available." : $"{item.Name} is now unavailable.",
            beforeAvailability,
            new { item.Id, item.Name, item.IsAvailable });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = request.IsAvailable ? "Menu item is now available." : "Menu item is now unavailable.",
            itemId = item.Id,
            item.IsAvailable
        });
    }

    [HttpPatch("{id:guid}/sold-out")]
    public async Task<IActionResult> UpdateSoldOut(
        Guid id,
        [FromBody] UpdateMenuItemSoldOutRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var beforeSoldOut = new { item.Id, item.Name, item.IsSoldOut };
        item.IsSoldOut = request.IsSoldOut;
        item.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "MenuItem.SoldOutChanged",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            request.IsSoldOut ? $"{item.Name} marked as sold out." : $"{item.Name} marked as in stock.",
            beforeSoldOut,
            new { item.Id, item.Name, item.IsSoldOut });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = request.IsSoldOut ? "Menu item marked as sold out." : "Menu item marked as in stock.",
            itemId = item.Id,
            item.IsSoldOut
        });
    }

    /// <summary>
    /// The watch list powering the dashboard widget: the handful of items staff want to flip on and
    /// off without opening the full menu.
    /// </summary>
    [HttpGet("watched")]
    public async Task<ActionResult<IReadOnlyList<WatchedMenuItemResponse>>> GetWatchedItems(
        [FromQuery] Guid? restaurantId,
        CancellationToken cancellationToken)
    {
        var scopedRestaurantId = restaurantId ?? await GetCurrentRestaurantIdAsync();

        if (scopedRestaurantId is null)
        {
            return BadRequest(new { message = "restaurantId is required for this account." });
        }

        if (!await CanAccessRestaurantAsync(scopedRestaurantId.Value))
        {
            return Forbid();
        }

        var items = await _dbContext.MenuItems
            .AsNoTracking()
            .Include(item => item.Category)
            .Where(item => item.RestaurantId == scopedRestaurantId.Value && item.IsWatched)
            .OrderBy(item => item.DisplayOrder)
            .ThenBy(item => item.Name)
            .Select(item => new WatchedMenuItemResponse
            {
                Id = item.Id,
                RestaurantId = item.RestaurantId,
                Name = item.Name,
                CategoryName = item.Category == null ? string.Empty : item.Category.Name,
                Price = item.Price,
                IsAvailable = item.IsAvailable,
                IsSoldOut = item.IsSoldOut,
                StockQuantity = item.StockQuantity
            })
            .ToListAsync(cancellationToken);

        return Ok(items);
    }

    [HttpPatch("{id:guid}/watch")]
    public async Task<IActionResult> UpdateWatch(
        Guid id,
        [FromBody] UpdateMenuItemWatchRequest request,
        CancellationToken cancellationToken)
    {
        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var beforeWatch = new { item.Id, item.Name, item.IsWatched };
        item.IsWatched = request.IsWatched;
        item.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "MenuItem.WatchChanged",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            request.IsWatched ? $"{item.Name} added to the watch list." : $"{item.Name} removed from the watch list.",
            beforeWatch,
            new { item.Id, item.Name, item.IsWatched });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = request.IsWatched ? "Menu item is now watched." : "Menu item is no longer watched.",
            itemId = item.Id,
            item.IsWatched
        });
    }

    /// <summary>
    /// Sets remaining stock. Null clears tracking, making the item unlimited again — which is how
    /// most items are configured. Stock and the sold-out flag are kept consistent here so staff
    /// never have to set both.
    /// </summary>
    [HttpPatch("{id:guid}/stock")]
    public async Task<IActionResult> UpdateStock(
        Guid id,
        [FromBody] UpdateMenuItemStockRequest request,
        CancellationToken cancellationToken)
    {
        if (request.StockQuantity is < 0)
        {
            return BadRequest(new { message = "stockQuantity cannot be negative." });
        }

        if (request.AdjustBy is not null && request.StockQuantity is not null)
        {
            return BadRequest(new { message = "Send either stockQuantity or adjustBy, not both." });
        }

        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var beforeStock = new { item.Id, item.Name, item.StockQuantity, item.IsSoldOut };

        if (request.AdjustBy is { } delta)
        {
            if (item.StockQuantity is null)
            {
                return BadRequest(new { message = "This item does not track stock, so there is nothing to adjust." });
            }

            // One statement, so the database adds to whatever the row holds right now. Reading the
            // count and writing the result back would lose an increment whenever two people pressed
            // the button at once, and both requests would report success.
            await _dbContext.MenuItems
                .Where(menuItem => menuItem.Id == id && menuItem.StockQuantity != null)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(
                            menuItem => menuItem.StockQuantity,
                            menuItem => Math.Max(0, menuItem.StockQuantity!.Value + delta))
                        .SetProperty(
                            menuItem => menuItem.IsSoldOut,
                            menuItem => Math.Max(0, menuItem.StockQuantity!.Value + delta) == 0)
                        .SetProperty(menuItem => menuItem.UpdatedAt, DateTime.UtcNow),
                    cancellationToken);

            await _dbContext.Entry(item).ReloadAsync(cancellationToken);
        }
        else
        {
            item.StockQuantity = request.StockQuantity;

            if (request.StockQuantity is { } quantity)
            {
                item.IsSoldOut = quantity == 0;
            }
        }

        item.UpdatedAt = DateTime.UtcNow;
        _reportLogWriter.AddAudit(
            "MenuItem.StockChanged",
            "MenuItem",
            item.Id.ToString(),
            item.RestaurantId,
            request.AdjustBy is { } adjustment
                ? $"{item.Name} stock adjusted by {adjustment:+#;-#;0} to {item.StockQuantity}."
                : request.StockQuantity is null
                    ? $"{item.Name} stock tracking turned off."
                    : $"{item.Name} stock set to {request.StockQuantity}.",
            beforeStock,
            new { item.Id, item.Name, item.StockQuantity, item.IsSoldOut });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = request.StockQuantity is null
                ? "Menu item is no longer stock tracked."
                : $"Menu item stock set to {request.StockQuantity}.",
            itemId = item.Id,
            item.StockQuantity,
            item.IsSoldOut
        });
    }

    [HttpPatch("bulk-state")]
    public async Task<IActionResult> UpdateItemsState(
        [FromBody] UpdateMenuItemsStateRequest request,
        CancellationToken cancellationToken)
    {
        if (request.RestaurantId == Guid.Empty)
        {
            return BadRequest(new { message = "Restaurant is required." });
        }

        if (request.ItemIds.Count == 0 || request.ItemIds.Distinct().Count() != request.ItemIds.Count)
        {
            return BadRequest(new { message = "Select one or more unique menu items." });
        }

        if (!await CanAccessRestaurantAsync(request.RestaurantId))
        {
            return Forbid();
        }

        var items = await _dbContext.MenuItems
            .Where(item => request.ItemIds.Contains(item.Id) && item.RestaurantId == request.RestaurantId)
            .ToListAsync(cancellationToken);

        if (items.Count != request.ItemIds.Count)
        {
            return BadRequest(new { message = "One or more selected menu items do not belong to this restaurant." });
        }

        var before = items
            .Select(item => new { item.Id, item.Name, item.IsAvailable, item.IsSoldOut })
            .ToList();
        var updatedAt = DateTime.UtcNow;

        foreach (var item in items)
        {
            item.IsAvailable = request.IsAvailable;
            item.IsSoldOut = request.IsSoldOut;
            item.UpdatedAt = updatedAt;
        }

        _reportLogWriter.AddAudit(
            "MenuItem.BulkStateUpdated",
            "Restaurant",
            request.RestaurantId.ToString(),
            request.RestaurantId,
            $"Updated operational state for {items.Count} menu items.",
            before,
            items.Select(item => new { item.Id, item.Name, item.IsAvailable, item.IsSoldOut }).ToList());
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = $"Updated {items.Count} menu item{(items.Count == 1 ? string.Empty : "s")}.",
            itemIds = items.Select(item => item.Id).ToList(),
            request.IsAvailable,
            request.IsSoldOut
        });
    }

    [HttpPost("reorder")]
    public async Task<IActionResult> ReorderItems(
        [FromBody] ReorderMenuItemsRequest request,
        CancellationToken cancellationToken)
    {
        if (request.CategoryId == Guid.Empty)
        {
            return BadRequest(new { message = "Category is required." });
        }

        if (request.ItemIds.Count == 0)
        {
            return BadRequest(new { message = "At least one menu item is required." });
        }

        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(menuCategory => menuCategory.Id == request.CategoryId, cancellationToken);

        if (category is null)
        {
            return NotFound(new { message = "Category not found." });
        }

        if (!await CanAccessRestaurantAsync(category.RestaurantId))
        {
            return Forbid();
        }

        if (request.ItemIds.Distinct().Count() != request.ItemIds.Count)
        {
            return BadRequest(new { message = "Menu item order contains duplicates." });
        }

        var categoryItems = await _dbContext.MenuItems
            .Where(item => item.CategoryId == request.CategoryId)
            .OrderBy(item => item.DisplayOrder)
            .ThenBy(item => item.Name)
            .ToListAsync(cancellationToken);

        if (categoryItems.Count == 0)
        {
            return BadRequest(new { message = "This category has no menu items to reorder." });
        }

        if (categoryItems.Count != request.ItemIds.Count)
        {
            return BadRequest(new { message = "Submit the full category item order when reordering." });
        }

        var categoryItemIds = categoryItems
            .Select(item => item.Id)
            .ToHashSet();

        if (request.ItemIds.Any(itemId => !categoryItemIds.Contains(itemId)))
        {
            return BadRequest(new { message = "One or more menu items do not belong to the selected category." });
        }

        var sortOrderByItemId = request.ItemIds
            .Select((itemId, index) => new { itemId, displayOrder = (index + 1) * 10 })
            .ToDictionary(entry => entry.itemId, entry => entry.displayOrder);

        var updatedAt = DateTime.UtcNow;
        var beforeOrder = categoryItems
            .Select(item => new { item.Id, item.Name, item.DisplayOrder })
            .ToList();

        foreach (var item in categoryItems)
        {
            item.DisplayOrder = sortOrderByItemId[item.Id];
            item.UpdatedAt = updatedAt;
        }

        _reportLogWriter.AddAudit(
            "MenuItem.Reordered",
            "MenuCategory",
            category.Id.ToString(),
            category.RestaurantId,
            $"Reordered menu items in {category.Name}.",
            beforeOrder,
            categoryItems
                .OrderBy(item => item.DisplayOrder)
                .Select(item => new { item.Id, item.Name, item.DisplayOrder })
                .ToList());
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Menu items reordered successfully."
        });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteItem(Guid id, CancellationToken cancellationToken)
    {
        var item = await _dbContext.MenuItems
            .FirstOrDefaultAsync(menuItem => menuItem.Id == id, cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Menu item not found." });
        }

        if (!await CanAccessRestaurantAsync(item.RestaurantId))
        {
            return Forbid();
        }

        var imageUrl = item.ImageUrl;
        var restaurantId = item.RestaurantId;
        var deletedItem = SnapshotItem(item);

        _dbContext.MenuItems.Remove(item);
        _reportLogWriter.AddAudit(
            "MenuItem.Deleted",
            "MenuItem",
            item.Id.ToString(),
            restaurantId,
            $"Deleted menu item {item.Name}.",
            deletedItem);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await DeleteManagedImageAsync(imageUrl, restaurantId, cancellationToken);

        return Ok(new
        {
            message = "Menu item deleted successfully.",
            itemId = id
        });
    }

    /// <summary>
    /// The one shape a menu item is returned in.
    ///
    /// <para>
    /// This used to be written out three times — once for the list, once for the single-item read
    /// and once for create/update — and the copies drifted: only the create/update copy carried
    /// <see cref="MenuItemResponse.MayContainAllergens"/>, <see cref="MenuItemResponse.CrossContactStatement"/>
    /// and <see cref="MenuItemResponse.AllergenInfoLastVerifiedAt"/>. Every other read reported an
    /// item's "may contain" and cross-contact declarations as null while they sat in the database,
    /// so the admin menu could not find them by search, counted the item as having declared no
    /// allergens, and — because the edit form fills itself from that same read — wrote the nulls
    /// back over the real text the next time anyone pressed Save.
    /// </para>
    /// </summary>
    private static readonly Expression<Func<MenuItem, MenuItemResponse>> ToResponse = item => new MenuItemResponse
    {
        Id = item.Id,
        RestaurantId = item.RestaurantId,
        CategoryId = item.CategoryId,
        CategoryName = item.Category != null ? item.Category.Name : string.Empty,
        Name = item.Name,
        Description = item.Description,
        Price = item.Price,
        ImageUrl = item.ImageUrl,
        IsAvailable = item.IsAvailable,
        IsSoldOut = item.IsSoldOut,
        IsWatched = item.IsWatched,
        StockQuantity = item.StockQuantity,
        IsVegetarian = item.IsVegetarian,
        IsVegan = item.IsVegan,
        IsGlutenFree = item.IsGlutenFree,
        IsHalal = item.IsHalal,
        Allergens = item.Allergens,
        MayContainAllergens = item.MayContainAllergens,
        CrossContactStatement = item.CrossContactStatement,
        AllergenInfoLastVerifiedAt = item.AllergenInfoLastVerifiedAt,
        SpiceLevel = item.SpiceLevel,
        ServingSize = item.ServingSize,
        Calories = item.Calories,
        IsPopular = item.IsPopular,
        IsRecommended = item.IsRecommended,
        DisplayOrder = item.DisplayOrder,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt,
        OptionGroups = item.OptionGroups
            .OrderBy(group => group.DisplayOrder)
            .Select(group => new MenuOptionGroupResponse
            {
                Id = group.Id,
                MenuItemId = group.MenuItemId,
                Name = group.Name,
                IsRequired = group.IsRequired,
                MinSelections = group.MinSelections,
                MaxSelections = group.MaxSelections,
                DisplayOrder = group.DisplayOrder,
                IsActive = group.IsActive,
                CreatedAt = group.CreatedAt,
                UpdatedAt = group.UpdatedAt,
                Options = group.Options
                    .OrderBy(option => option.DisplayOrder)
                    .Select(option => new MenuOptionResponse
                    {
                        Id = option.Id,
                        GroupId = option.GroupId,
                        Name = option.Name,
                        PriceAdjustment = option.PriceAdjustment,
                        AdjustmentType = (int)option.AdjustmentType,
                        MaxQuantity = option.MaxQuantity,
                        DisplayOrder = option.DisplayOrder,
                        Allergens = option.Allergens,
                        MayContainAllergens = option.MayContainAllergens,
                        CrossContactStatement = option.CrossContactStatement,
                        IsAvailable = option.IsAvailable,
                        CreatedAt = option.CreatedAt,
                        UpdatedAt = option.UpdatedAt
                    })
                    .ToList()
            })
            .ToList()
    };

    /// <summary>The same projection, for an item already in memory rather than in a query.</summary>
    private static readonly Func<MenuItem, MenuItemResponse> ToResponseInMemory = ToResponse.Compile();

    /// <summary>
    /// The item's version. An item that has never been edited has no <c>UpdatedAt</c>, and treating
    /// that as "no version to check" would leave every newly created item unprotected — which is
    /// exactly when two people are most likely to be filling in the same new dish.
    /// </summary>
    private static DateTime VersionOf(MenuItem item) => item.UpdatedAt ?? item.CreatedAt;

    /// <summary>
    /// True when the row has moved on since the editor loaded it.
    ///
    /// <para>
    /// Compared to the millisecond rather than exactly: the value makes a round trip through JSON
    /// and back, and a comparison tight enough to fail on a rounding difference would reject every
    /// save. A millisecond is far shorter than the gap between two people pressing Save, and the
    /// database's own microsecond resolution is what separates two saves that genuinely race.
    /// </para>
    /// </summary>
    private static bool WasChangedElsewhere(MenuItem item, DateTime expectedUpdatedAt) =>
        Math.Abs((VersionOf(item) - expectedUpdatedAt).TotalMilliseconds) > 1;

    /// <summary>
    /// Why this restaurant cannot be charged this price, or null when it can. Reads the currency
    /// from the restaurant rather than assuming AUD, because what counts as a payable fraction is a
    /// property of the currency and not of the menu.
    /// </summary>
    private async Task<string?> DescribePriceProblemAsync(
        Guid restaurantId,
        decimal price,
        CancellationToken cancellationToken)
    {
        var currency = await _dbContext.Restaurants
            .AsNoTracking()
            .Where(restaurant => restaurant.Id == restaurantId)
            .Select(restaurant => restaurant.Currency)
            .FirstOrDefaultAsync(cancellationToken);

        return CurrencyPrecision.DescribeProblem(price, currency, "Price");
    }

    private async Task<MenuItemResponse?> FindItemResponseAsync(
        Guid id,
        CancellationToken cancellationToken)
    {
        return await _dbContext.MenuItems
            .AsNoTracking()
            .Where(item => item.Id == id)
            .Select(ToResponse)
            .FirstOrDefaultAsync(cancellationToken);
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

    private async Task<bool> ItemNameExistsAsync(
        Guid categoryId,
        string name,
        Guid? excludedItemId,
        CancellationToken cancellationToken)
    {
        var normalizedName = name.ToLower();

        return await _dbContext.MenuItems.AnyAsync(item =>
            item.CategoryId == categoryId &&
            (!excludedItemId.HasValue || item.Id != excludedItemId.Value) &&
            item.Name.ToLower() == normalizedName,
            cancellationToken);
    }

    private static string? ValidateRequest(
        Guid categoryId,
        string? name,
        string? description,
        decimal price,
        string? imageUrl,
        int displayOrder,
        string? allergens,
        int spiceLevel,
        string? servingSize,
        int? calories)
    {
        if (categoryId == Guid.Empty)
        {
            return "Category is required.";
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return "Item name is required.";
        }

        if (name.Trim().Length > MaximumNameLength)
        {
            return $"Item name must not exceed {MaximumNameLength} characters.";
        }

        if (description?.Trim().Length > MaximumDescriptionLength)
        {
            return $"Item description must not exceed {MaximumDescriptionLength} characters.";
        }

        if (price < 0.01m || price > MaximumPrice)
        {
            return $"Price must be between 0.01 and {MaximumPrice}.";
        }

        if (imageUrl?.Trim().Length > MaximumImageUrlLength)
        {
            return $"Image URL must not exceed {MaximumImageUrlLength} characters.";
        }

        if (displayOrder < 0 || displayOrder > MaximumDisplayOrder)
        {
            return $"Display order must be between 0 and {MaximumDisplayOrder}.";
        }

        if (allergens?.Trim().Length > 500)
        {
            return "Allergens must not exceed 500 characters.";
        }

        if (spiceLevel is < 0 or > 3)
        {
            return "Spice level must be between 0 and 3.";
        }

        if (servingSize?.Trim().Length > 80)
        {
            return "Serving size must not exceed 80 characters.";
        }

        if (calories is < 0 or > 10000)
        {
            return "Calories must be between 0 and 10000.";
        }

        return null;
    }

    private static string? NormalizeOptionalValue(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    /// <summary>
    /// When the allergen information was last actually supplied. Saving an item with all three
    /// allergen fields empty must leave this null: a timestamp on empty information reads as
    /// "checked, nothing to declare" when the truth is "nobody has checked", and it is shown to
    /// customers. Unchanged information keeps its original timestamp rather than being refreshed
    /// by an edit to the price or the photo.
    /// </summary>
    private static DateTime? ResolveAllergenVerifiedAt(
        string? allergens,
        string? mayContainAllergens,
        string? crossContactStatement,
        string? previousAllergens = null,
        string? previousMayContainAllergens = null,
        string? previousCrossContactStatement = null,
        DateTime? previousVerifiedAt = null)
    {
        var hasAllergenInformation = allergens is not null
            || mayContainAllergens is not null
            || crossContactStatement is not null;

        if (!hasAllergenInformation)
        {
            return null;
        }

        var unchanged = string.Equals(allergens, previousAllergens, StringComparison.Ordinal)
            && string.Equals(mayContainAllergens, previousMayContainAllergens, StringComparison.Ordinal)
            && string.Equals(crossContactStatement, previousCrossContactStatement, StringComparison.Ordinal);

        return unchanged && previousVerifiedAt.HasValue ? previousVerifiedAt : DateTime.UtcNow;
    }

    private bool IsS3StorageEnabled()
    {
        return string.Equals(_storageOptions.Provider, "S3", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(_storageOptions.Bucket);
    }

    private string BuildPublicImageUrl(string objectKey)
    {
        if (!string.IsNullOrWhiteSpace(_storageOptions.PublicBaseUrl))
        {
            return $"{_storageOptions.PublicBaseUrl.TrimEnd('/')}/{objectKey}";
        }

        return $"https://{_storageOptions.Bucket}.s3.{_storageOptions.Region}.amazonaws.com/{objectKey}";
    }

    private string RewriteUploadUrlForClient(string uploadUrl)
    {
        if (string.IsNullOrWhiteSpace(_storageOptions.UploadBaseUrl) ||
            !Uri.TryCreate(uploadUrl, UriKind.Absolute, out var generatedUri) ||
            !Uri.TryCreate(_storageOptions.UploadBaseUrl, UriKind.Absolute, out var clientBaseUri))
        {
            return uploadUrl;
        }

        var builder = new UriBuilder(generatedUri)
        {
            Scheme = clientBaseUri.Scheme,
            Host = clientBaseUri.Host,
            Port = clientBaseUri.IsDefaultPort ? -1 : clientBaseUri.Port
        };

        return builder.Uri.ToString();
    }

    private async Task DeleteManagedImageAsync(
        string? imageUrl,
        Guid restaurantId,
        CancellationToken cancellationToken)
    {
        if (!TryGetManagedImageObjectKey(imageUrl, restaurantId, out var objectKey))
        {
            return;
        }

        try
        {
            await _s3Client.DeleteObjectAsync(_storageOptions.Bucket, objectKey, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete previous menu image {ObjectKey}.", objectKey);
        }
    }

    private bool TryGetManagedImageObjectKey(string? imageUrl, Guid restaurantId, out string objectKey)
    {
        objectKey = string.Empty;

        if (string.IsNullOrWhiteSpace(imageUrl) || string.IsNullOrWhiteSpace(_storageOptions.PublicBaseUrl))
        {
            return false;
        }

        var publicBaseUrl = _storageOptions.PublicBaseUrl.TrimEnd('/');

        if (!imageUrl.StartsWith($"{publicBaseUrl}/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var candidateKey = Uri.UnescapeDataString(imageUrl[(publicBaseUrl.Length + 1)..]);
        var ownedPrefix = $"uploads/menu-items/{restaurantId}/";

        if (!candidateKey.StartsWith(ownedPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        objectKey = candidateKey;
        return true;
    }

    /// <summary>
    /// After a write, where the category name is known but the navigation may not be loaded.
    /// </summary>
    private static MenuItemResponse MapToResponse(MenuItem item, string categoryName)
    {
        var response = ToResponseInMemory(item);
        response.CategoryName = categoryName;
        return response;
    }

    private static object SnapshotItem(MenuItem item) => new
    {
        item.Id,
        item.RestaurantId,
        item.CategoryId,
        item.Name,
        item.Description,
        item.Price,
        item.ImageUrl,
        item.IsAvailable,
        item.IsSoldOut,
        item.IsVegetarian,
        item.IsVegan,
        item.IsGlutenFree,
        item.IsHalal,
        item.Allergens,
        item.SpiceLevel,
        item.ServingSize,
        item.Calories,
        item.IsPopular,
        item.IsRecommended,
        item.DisplayOrder
    };
}
