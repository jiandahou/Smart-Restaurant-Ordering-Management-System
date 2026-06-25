using System.Security.Cryptography;
using DineFlow.Api.Contracts.Cart;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Menu;
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
                    .ThenInclude(item => item!.OptionGroups.Where(group => group.IsActive))
                        .ThenInclude(group => group.Options.Where(option => option.IsAvailable))
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
            .Select(item =>
            {
                var selectedOptions = GetSelectedOptions(item);
                var unitPrice = CalculateUnitPrice(item.MenuItem?.Price ?? 0, selectedOptions);

                return new CartItemResponse
                {
                    Id = item.Id,
                    MenuItemId = item.MenuItemId,
                    Name = item.MenuItem?.Name ?? "Unavailable item",
                    ImageUrl = item.MenuItem?.ImageUrl,
                    Quantity = item.Quantity,
                    UnitPrice = unitPrice,
                    LineTotal = item.Quantity * unitPrice,
                    Note = item.Note,
                    SelectedOptions = selectedOptions.Select(option => new CartItemOptionResponse
                    {
                        MenuItemOptionId = option.Option.Id,
                        GroupNameSnapshot = option.Group.Name,
                        OptionNameSnapshot = option.Option.Name,
                        PriceAdjustmentSnapshot = option.Option.PriceAdjustment,
                        Quantity = option.Quantity
                    }).ToList(),
                    IsAvailable = item.MenuItem?.IsAvailable == true,
                    IsSoldOut = item.MenuItem?.IsSoldOut == true,
                    CreatedAt = item.CreatedAt,
                    UpdatedAt = item.UpdatedAt
                };
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

    private static IReadOnlyList<CartSelectedOption> GetSelectedOptions(CartItem item)
    {
        if (item.MenuItem is null || item.SelectedOptionIds.Length == 0)
        {
            return [];
        }

        var selectedOptionCounts = item.SelectedOptionIds
            .Where(optionId => optionId != Guid.Empty)
            .GroupBy(optionId => optionId)
            .ToDictionary(group => group.Key, group => group.Count());

        return item.MenuItem.OptionGroups
            .OrderBy(group => group.DisplayOrder)
            .ThenBy(group => group.Name)
            .SelectMany(group => group.Options
                .OrderBy(option => option.DisplayOrder)
                .ThenBy(option => option.Name)
                .Where(option => selectedOptionCounts.ContainsKey(option.Id))
                .Select(option => new CartSelectedOption(group, option, selectedOptionCounts[option.Id])))
            .ToList();
    }

    private static decimal CalculateUnitPrice(decimal basePrice, IEnumerable<CartSelectedOption> selectedOptions)
    {
        var unitPrice = basePrice;

        foreach (var selectedOption in selectedOptions)
        {
            var option = selectedOption.Option;
            unitPrice = option.AdjustmentType switch
            {
                OptionAdjustmentType.Add => unitPrice + option.PriceAdjustment * selectedOption.Quantity,
                OptionAdjustmentType.Remove => unitPrice + option.PriceAdjustment * selectedOption.Quantity,
                OptionAdjustmentType.Replace => option.PriceAdjustment,
                _ => unitPrice
            };
        }

        return unitPrice;
    }

    private sealed record CartSelectedOption(MenuItemOptionGroup Group, MenuItemOption Option, int Quantity);
}
