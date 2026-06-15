using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using DineFlow.Api.Contracts.Cart;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/public/carts")]
public class PublicCartsController(
    AppDbContext dbContext,
    CartAccessService cartAccessService,
    CartRealtimeNotifier cartRealtimeNotifier) : ControllerBase
{
    private const string ParticipantTokenHeader = "X-Cart-Participant-Token";
    private const int MaximumItemQuantity = 100;
    private const int MaximumItemNoteLength = 2_000;
    private const int MaximumCartNoteLength = 4_000;
    private static readonly TimeSpan DineInCartLifetime = TimeSpan.FromHours(8);
    private static readonly TimeSpan TakeawayCartLifetime = TimeSpan.FromHours(24);

    [HttpPost("join")]
    public async Task<IActionResult> JoinCart(
        JoinCartRequest request,
        CancellationToken cancellationToken)
    {
        var hasRestaurantId = request.RestaurantId.HasValue;
        var hasTableToken = !string.IsNullOrWhiteSpace(request.TableQrToken);

        if (hasRestaurantId == hasTableToken)
        {
            return BadRequest(new
            {
                message = "Provide either restaurantId or tableQrToken, but not both."
            });
        }

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var now = DateTime.UtcNow;
        Cart cart;

        if (hasTableToken)
        {
            var qrToken = request.TableQrToken!.Trim();
            var table = await dbContext.RestaurantTables
                .FromSqlInterpolated(
                    $"SELECT * FROM \"RestaurantTables\" WHERE \"QrToken\" = {qrToken} FOR UPDATE")
                .FirstOrDefaultAsync(cancellationToken);

            if (table is null || !table.IsActive)
            {
                return NotFound(new { message = "Table QR code is invalid or unavailable." });
            }

            var restaurantIsActive = await dbContext.Restaurants
                .AsNoTracking()
                .AnyAsync(
                    restaurant => restaurant.Id == table.RestaurantId && restaurant.IsActive,
                    cancellationToken);

            if (!restaurantIsActive)
            {
                return NotFound(new { message = "Restaurant is not available for ordering." });
            }

            var activeCart = await dbContext.Carts
                .FirstOrDefaultAsync(
                    item => item.TableId == table.Id && item.Status == CartStatus.Active,
                    cancellationToken);

            if (activeCart is not null && activeCart.ExpiresAt <= now)
            {
                activeCart.Status = CartStatus.Expired;
                activeCart.UpdatedAt = now;
                await dbContext.SaveChangesAsync(cancellationToken);
                activeCart = null;
            }

            cart = activeCart ?? new Cart
            {
                Id = Guid.NewGuid(),
                RestaurantId = table.RestaurantId,
                TableId = table.Id,
                OrderType = OrderType.DineIn,
                Status = CartStatus.Active,
                ExpiresAt = now.Add(DineInCartLifetime),
                CreatedAt = now
            };

            if (activeCart is null)
            {
                await dbContext.Carts.AddAsync(cart, cancellationToken);
            }
        }
        else
        {
            var restaurantId = request.RestaurantId!.Value;
            var restaurantIsActive = await dbContext.Restaurants
                .AsNoTracking()
                .AnyAsync(
                    restaurant => restaurant.Id == restaurantId && restaurant.IsActive,
                    cancellationToken);

            if (!restaurantIsActive)
            {
                return NotFound(new { message = "Restaurant is not available for ordering." });
            }

            cart = new Cart
            {
                Id = Guid.NewGuid(),
                RestaurantId = restaurantId,
                TableId = null,
                OrderType = OrderType.Takeaway,
                Status = CartStatus.Active,
                ExpiresAt = now.Add(TakeawayCartLifetime),
                CreatedAt = now
            };

            await dbContext.Carts.AddAsync(cart, cancellationToken);
        }

        var participantToken = GenerateParticipantToken();
        var participant = new CartParticipant
        {
            Id = Guid.NewGuid(),
            CartId = cart.Id,
            CustomerId = User.FindFirstValue(ClaimTypes.NameIdentifier),
            ParticipantTokenHash = CartAccessService.HashParticipantToken(participantToken),
            JoinedAt = now,
            LastSeenAt = now
        };

        await dbContext.CartParticipants.AddAsync(participant, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var snapshot = await cartAccessService.LoadSnapshotAsync(cart.Id, cancellationToken);

        return Ok(new JoinCartResponse
        {
            ParticipantToken = participantToken,
            Cart = snapshot!
        });
    }

    [HttpGet("{cartId:guid}")]
    public async Task<IActionResult> GetCart(
        Guid cartId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        await cartAccessService.TouchParticipantAsync(access.Participant!, cancellationToken);
        var snapshot = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);
        return Ok(snapshot);
    }

    [HttpPost("{cartId:guid}/items")]
    public async Task<IActionResult> AddItem(
        Guid cartId,
        AddCartItemRequest request,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateItem(request.Quantity, request.Note);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var cart = access.Cart!;
        var menuItem = await dbContext.MenuItems
            .AsNoTracking()
            .Where(item =>
                item.Id == request.MenuItemId &&
                item.RestaurantId == cart.RestaurantId &&
                item.IsAvailable &&
                !item.IsSoldOut)
            .Join(
                dbContext.MenuCategories.AsNoTracking().Where(category =>
                    category.RestaurantId == cart.RestaurantId && category.IsActive),
                item => item.CategoryId,
                category => category.Id,
                (item, _) => item)
            .FirstOrDefaultAsync(cancellationToken);

        if (menuItem is null)
        {
            return Conflict(new { message = "Menu item is unavailable, sold out, or belongs to another restaurant." });
        }

        var note = NormalizeNote(request.Note);
        var existingLine = await dbContext.CartItems.FirstOrDefaultAsync(
            item => item.CartId == cartId && item.MenuItemId == request.MenuItemId && item.Note == note,
            cancellationToken);

        if (existingLine is null)
        {
            await dbContext.CartItems.AddAsync(new CartItem
            {
                Id = Guid.NewGuid(),
                CartId = cartId,
                MenuItemId = request.MenuItemId,
                Quantity = request.Quantity,
                Note = note,
                CreatedAt = DateTime.UtcNow
            }, cancellationToken);
        }
        else
        {
            if (existingLine.Quantity + request.Quantity > MaximumItemQuantity)
            {
                return BadRequest(new { message = $"Item quantity cannot exceed {MaximumItemQuantity}." });
            }

            existingLine.Quantity += request.Quantity;
            existingLine.UpdatedAt = DateTime.UtcNow;
        }

        cart.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "item-added", cancellationToken);
    }

    [HttpPut("{cartId:guid}/items/{cartItemId:guid}")]
    public async Task<IActionResult> UpdateItem(
        Guid cartId,
        Guid cartItemId,
        UpdateCartItemRequest request,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateItem(request.Quantity, request.Note);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var item = await dbContext.CartItems.FirstOrDefaultAsync(
            cartItem => cartItem.Id == cartItemId && cartItem.CartId == cartId,
            cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Cart item not found." });
        }

        item.Quantity = request.Quantity;
        item.Note = NormalizeNote(request.Note);
        item.UpdatedAt = DateTime.UtcNow;
        access.Cart!.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "item-updated", cancellationToken);
    }

    [HttpDelete("{cartId:guid}/items/{cartItemId:guid}")]
    public async Task<IActionResult> DeleteItem(
        Guid cartId,
        Guid cartItemId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var item = await dbContext.CartItems.FirstOrDefaultAsync(
            cartItem => cartItem.Id == cartItemId && cartItem.CartId == cartId,
            cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Cart item not found." });
        }

        dbContext.CartItems.Remove(item);
        access.Cart!.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "item-removed", cancellationToken);
    }

    [HttpPut("{cartId:guid}/note")]
    public async Task<IActionResult> UpdateNote(
        Guid cartId,
        UpdateCartNoteRequest request,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        if (request.Note?.Trim().Length > MaximumCartNoteLength)
        {
            return BadRequest(new { message = $"Cart note cannot exceed {MaximumCartNoteLength} characters." });
        }

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        access.Cart!.CustomerNote = NormalizeNote(request.Note);
        access.Cart.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "note-updated", cancellationToken);
    }

    private async Task<CartAccessResult> AuthorizeMutableCartAsync(
        Guid cartId,
        string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access;
        }

        if (access.Cart!.Status != CartStatus.Active)
        {
            return access with
            {
                ErrorResult = Conflict(new { message = "Cart is no longer active." })
            };
        }

        var restaurantIsActive = await dbContext.Restaurants
            .AsNoTracking()
            .AnyAsync(
                restaurant => restaurant.Id == access.Cart.RestaurantId && restaurant.IsActive,
                cancellationToken);

        var tableIsActive = !access.Cart.TableId.HasValue || await dbContext.RestaurantTables
            .AsNoTracking()
            .AnyAsync(
                table => table.Id == access.Cart.TableId.Value && table.IsActive,
                cancellationToken);

        if (!restaurantIsActive || !tableIsActive)
        {
            return access with
            {
                ErrorResult = Conflict(new { message = "Restaurant or table is no longer available for ordering." })
            };
        }

        return access;
    }

    private async Task<CartAccessResult> AuthorizeCartAsync(
        Guid cartId,
        string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await cartAccessService.AuthorizeAsync(
            cartId,
            participantToken,
            cancellationToken);

        if (access.Failure == CartAccessFailure.Expired)
        {
            await cartRealtimeNotifier.CartExpiredAsync(cartId, cancellationToken);
        }

        var errorResult = access.Failure switch
        {
            CartAccessFailure.None => null,
            CartAccessFailure.NotFound => NotFound(new { message = "Cart not found." }),
            CartAccessFailure.Expired => StatusCode(
                StatusCodes.Status410Gone,
                new { message = "Cart has expired." }),
            _ => Unauthorized(new { message = "A valid cart participant token is required." })
        };

        return new CartAccessResult(access.Cart, access.Participant, errorResult);
    }

    private static string GenerateParticipantToken()
    {
        return WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
    }

    private async Task<IActionResult> ReturnUpdatedCartAsync(
        Guid cartId,
        string reason,
        CancellationToken cancellationToken)
    {
        var snapshot = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);

        if (snapshot is null)
        {
            return NotFound(new { message = "Cart not found." });
        }

        await cartRealtimeNotifier.CartUpdatedAsync(
            cartId,
            reason,
            snapshot,
            cancellationToken);

        return Ok(snapshot);
    }

    private static string? ValidateItem(int quantity, string? note)
    {
        if (quantity < 1 || quantity > MaximumItemQuantity)
        {
            return $"Item quantity must be between 1 and {MaximumItemQuantity}.";
        }

        if (note?.Trim().Length > MaximumItemNoteLength)
        {
            return $"Item note cannot exceed {MaximumItemNoteLength} characters.";
        }

        return null;
    }

    private static string? NormalizeNote(string? note)
    {
        return string.IsNullOrWhiteSpace(note) ? null : note.Trim();
    }

    private sealed record CartAccessResult(
        Cart? Cart,
        CartParticipant? Participant,
        IActionResult? ErrorResult);
}
