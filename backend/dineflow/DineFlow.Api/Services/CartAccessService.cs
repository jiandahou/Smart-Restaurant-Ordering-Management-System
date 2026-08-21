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
    CartAccessFailure Failure,
    /// <summary>
    /// True only for the request that actually moved the cart to expired. Expiry is reported to
    /// every caller from then on, but announcing it over the realtime channel more than once would
    /// mean re-broadcasting to the table on every poll.
    /// </summary>
    bool JustExpired = false);

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

        // Expiry is a state, not an event. This used to do both jobs in one condition — notice the
        // deadline had passed *and* report it — so only the first caller to arrive after the
        // deadline was told the cart had expired. It flipped the status on the way past, which made
        // the condition false for everyone after: they fell through as an ordinary cart, failed the
        // "must be active" check further along, and were told the cart was "no longer active" with
        // a 409. Same cart, same reason, a different answer depending on who got there first.
        var justExpired = cart.Status == CartStatus.Active && cart.ExpiresAt <= DateTime.UtcNow;

        if (justExpired)
        {
            cart.Status = CartStatus.Expired;
            cart.UpdatedAt = DateTime.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        if (cart.Status == CartStatus.Expired)
        {
            return new CartAccessValidation(cart, null, CartAccessFailure.Expired, justExpired);
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
            // The category decides whether a dish is still being served, and the snapshot could not
            // see it: not loading it is what made this check silently unaskable.
            .Include(item => item.Items)
                .ThenInclude(item => item.MenuItem)
                    .ThenInclude(item => item!.Category)
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
                var availability = CartLineAvailability.Evaluate(item.MenuItem, cart.RestaurantId);
                var basePrice = item.MenuItem?.Price ?? 0;
                var unitPrice = PricingCalculator.CalculateUnitPrice(
                    basePrice,
                    selectedOptions.Select(option => new MenuOptionPriceSelection(option.Option, option.Quantity)));

                return new CartItemResponse
                {
                    Id = item.Id,
                    MenuItemId = item.MenuItemId,
                    Name = item.MenuItem?.Name ?? "Unavailable item",
                    ImageUrl = item.MenuItem?.ImageUrl,
                    Quantity = item.Quantity,
                    BasePrice = basePrice,
                    UnitPrice = unitPrice,
                    LineTotal = PricingCalculator.CalculateLineTotal(item.Quantity, unitPrice),
                    Note = item.Note,
                    SelectedOptions = selectedOptions.Select(option => new CartItemOptionResponse
                    {
                        MenuItemOptionId = option.Option.Id,
                        GroupNameSnapshot = option.Group.Name,
                        OptionNameSnapshot = option.Option.Name,
                        PriceAdjustmentSnapshot = option.Option.PriceAdjustment,
                        // Live rather than snapshotted: a cart is still being decided, so it should
                        // show the declaration as it stands now, not as it stood when added.
                        AllergensSnapshot = option.Option.Allergens,
                        MayContainAllergensSnapshot = option.Option.MayContainAllergens,
                        CrossContactStatementSnapshot = option.Option.CrossContactStatement,
                        Quantity = option.Quantity
                    }).ToList(),
                    IsAvailable = item.MenuItem?.IsAvailable == true,
                    IsSoldOut = item.MenuItem?.IsSoldOut == true,
                    IsOrderable = availability.IsOrderable,
                    UnavailableReason = availability.Reason,
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
            Total = PricingCalculator.CalculateTotal(items.Select(item => (item.Quantity, item.UnitPrice))),
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

    private sealed record CartSelectedOption(MenuItemOptionGroup Group, MenuItemOption Option, int Quantity);
}
