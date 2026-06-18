using System.Security.Cryptography;
using DineFlow.Api.Contracts.Cart;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public enum CartAccessFailure
{
    None,
    InvalidToken,
    NotFound,
    Expired
}

public sealed record CartAccessValidation(
    Cart? Cart,
    CartParticipant? Participant,
    CartAccessFailure Failure);

public sealed class CartAccessService(AppDbContext dbContext)
{
    public async Task<CartAccessValidation> AuthorizeAsync(
        Guid cartId,
        string? participantToken,
        CancellationToken cancellationToken)
    {
        if (!TryHashParticipantToken(participantToken, out var suppliedHash))
        {
            return new CartAccessValidation(null, null, CartAccessFailure.InvalidToken);
        }

        var cart = await dbContext.Carts.FirstOrDefaultAsync(
            item => item.Id == cartId,
            cancellationToken);

        if (cart is null)
        {
            return new CartAccessValidation(null, null, CartAccessFailure.NotFound);
        }

        if (cart.Status == CartStatus.Active && cart.ExpiresAt <= DateTime.UtcNow)
        {
            cart.Status = CartStatus.Expired;
            cart.UpdatedAt = DateTime.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);

            return new CartAccessValidation(cart, null, CartAccessFailure.Expired);
        }

        var participants = await dbContext.CartParticipants
            .Include(participant => participant.Customer)
            .Where(participant => participant.CartId == cartId)
            .ToListAsync(cancellationToken);

        var participant = participants.FirstOrDefault(item =>
            item.ParticipantTokenHash.Length == suppliedHash.Length &&
            CryptographicOperations.FixedTimeEquals(item.ParticipantTokenHash, suppliedHash));

        return participant is null
            ? new CartAccessValidation(null, null, CartAccessFailure.InvalidToken)
            : new CartAccessValidation(cart, participant, CartAccessFailure.None);
    }

    public async Task TouchParticipantAsync(
        CartParticipant participant,
        CancellationToken cancellationToken)
    {
        participant.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<CartResponse?> LoadSnapshotAsync(
        Guid cartId,
        CancellationToken cancellationToken)
    {
        var cart = await dbContext.Carts
            .AsNoTracking()
            .Include(item => item.Table)
            .Include(item => item.Items)
                .ThenInclude(item => item.MenuItem)
            .FirstOrDefaultAsync(item => item.Id == cartId, cancellationToken);

        return cart is null ? null : MapCart(cart);
    }

    public static byte[] HashParticipantToken(string participantToken)
    {
        return SHA256.HashData(WebEncoders.Base64UrlDecode(participantToken));
    }

    private static bool TryHashParticipantToken(string? participantToken, out byte[] hash)
    {
        hash = [];

        if (string.IsNullOrWhiteSpace(participantToken))
        {
            return false;
        }

        try
        {
            var tokenBytes = WebEncoders.Base64UrlDecode(participantToken.Trim());

            if (tokenBytes.Length != 32)
            {
                return false;
            }

            hash = SHA256.HashData(tokenBytes);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static CartResponse MapCart(Cart cart)
    {
        var items = cart.Items
            .OrderBy(item => item.CreatedAt)
            .Select(item => new CartItemResponse
            {
                Id = item.Id,
                MenuItemId = item.MenuItemId,
                Name = item.MenuItem?.Name ?? "Unavailable item",
                ImageUrl = item.MenuItem?.ImageUrl,
                Quantity = item.Quantity,
                UnitPrice = item.MenuItem?.Price ?? 0,
                LineTotal = item.Quantity * (item.MenuItem?.Price ?? 0),
                Note = item.Note,
                IsAvailable = item.MenuItem?.IsAvailable == true,
                IsSoldOut = item.MenuItem?.IsSoldOut == true,
                CreatedAt = item.CreatedAt,
                UpdatedAt = item.UpdatedAt
            })
            .ToList();

        return new CartResponse
        {
            Id = cart.Id,
            RestaurantId = cart.RestaurantId,
            TableId = cart.TableId,
            TableNumber = cart.Table?.TableNumber,
            OrderType = cart.OrderType.ToString(),
            Status = cart.Status.ToString(),
            CustomerNote = cart.CustomerNote,
            ExpiresAt = cart.ExpiresAt,
            CreatedAt = cart.CreatedAt,
            UpdatedAt = cart.UpdatedAt,
            Total = items.Sum(item => item.LineTotal),
            ItemCount = items.Sum(item => item.Quantity),
            Items = items
        };
    }
}
