using Amazon.S3;
using Amazon.S3.Model;
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

    public AdminMenuItemsController(
        AppDbContext dbContext,
        UserManager<ApplicationUser> userManager,
        IOptions<AvatarStorageOptions> storageOptions,
        IAmazonS3 s3Client,
        ILogger<AdminMenuItemsController> logger,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _storageOptions = storageOptions.Value;
        _s3Client = s3Client;
        _logger = logger;
        _reportLogWriter = reportLogWriter;
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
            .Select(item => new MenuItemResponse
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
                IsVegetarian = item.IsVegetarian,
                IsVegan = item.IsVegan,
                IsGlutenFree = item.IsGlutenFree,
                IsHalal = item.IsHalal,
                Allergens = item.Allergens,
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
                                IsAvailable = option.IsAvailable,
                                CreatedAt = option.CreatedAt,
                                UpdatedAt = option.UpdatedAt
                            })
                            .ToList()
                    })
                    .ToList()
            })
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
            request.DisplayOrder);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(category => category.Id == request.CategoryId, cancellationToken);

        if (category is null || category.RestaurantId != request.RestaurantId)
        {
            return BadRequest(new { message = "Category does not belong to the selected restaurant." });
        }

        var name = request.Name.Trim();

        if (await ItemNameExistsAsync(request.CategoryId, name, null, cancellationToken))
        {
            return Conflict(new { message = "An item with this name already exists in the category." });
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
            request.DisplayOrder);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var category = await _dbContext.MenuCategories
            .AsNoTracking()
            .FirstOrDefaultAsync(menuCategory => menuCategory.Id == request.CategoryId, cancellationToken);

        if (category is null || category.RestaurantId != item.RestaurantId)
        {
            return BadRequest(new { message = "Category does not belong to the item's restaurant." });
        }

        var name = request.Name.Trim();

        if (await ItemNameExistsAsync(request.CategoryId, name, item.Id, cancellationToken))
        {
            return Conflict(new { message = "An item with this name already exists in the category." });
        }

        var previousImageUrl = item.ImageUrl;
        var beforeItem = SnapshotItem(item);

        item.CategoryId = request.CategoryId;
        item.Name = name;
        item.Description = NormalizeOptionalValue(request.Description);
        item.Price = request.Price;
        item.ImageUrl = NormalizeOptionalValue(request.ImageUrl);
        item.IsAvailable = request.IsAvailable;
        item.IsSoldOut = request.IsSoldOut;
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

    private async Task<MenuItemResponse?> FindItemResponseAsync(
        Guid id,
        CancellationToken cancellationToken)
    {
        return await _dbContext.MenuItems
            .AsNoTracking()
            .Where(item => item.Id == id)
            .Select(item => new MenuItemResponse
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
                IsVegetarian = item.IsVegetarian,
                IsVegan = item.IsVegan,
                IsGlutenFree = item.IsGlutenFree,
                IsHalal = item.IsHalal,
                Allergens = item.Allergens,
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
                                IsAvailable = option.IsAvailable,
                                CreatedAt = option.CreatedAt,
                                UpdatedAt = option.UpdatedAt
                            })
                            .ToList()
                    })
                    .ToList()
            })
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
        int displayOrder)
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

        return null;
    }

    private static string? NormalizeOptionalValue(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
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

    private static MenuItemResponse MapToResponse(MenuItem item, string categoryName)
    {
        return new MenuItemResponse
        {
            Id = item.Id,
            RestaurantId = item.RestaurantId,
            CategoryId = item.CategoryId,
            CategoryName = categoryName,
            Name = item.Name,
            Description = item.Description,
            Price = item.Price,
            ImageUrl = item.ImageUrl,
            IsAvailable = item.IsAvailable,
            IsSoldOut = item.IsSoldOut,
            IsVegetarian = item.IsVegetarian,
            IsVegan = item.IsVegan,
            IsGlutenFree = item.IsGlutenFree,
            IsHalal = item.IsHalal,
            Allergens = item.Allergens,
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
                            IsAvailable = option.IsAvailable,
                            CreatedAt = option.CreatedAt,
                            UpdatedAt = option.UpdatedAt
                        })
                        .ToList()
                })
                .ToList()
        };
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
        item.DisplayOrder
    };
}
