using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Cart;
using DineFlow.Api.Compliance;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using Stripe;
using Stripe.Checkout;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/public/carts")]
// Anonymous, and the participant token is the only credential. Applies to every action here,
// including join — creating carts in bulk is its own kind of abuse.
[EnableRateLimiting(RateLimitPolicies.CartAccess)]
public class PublicCartsController(
    AppDbContext dbContext,
    CartAccessService cartAccessService,
    CartRealtimeNotifier cartRealtimeNotifier,
    OrderRealtimeNotifier orderRealtimeNotifier,
    OrderPickupNumberService orderPickupNumberService,
    MenuItemStockService menuItemStockService,
    OrderAutoAcceptanceService orderAutoAcceptanceService,
    ReportLogWriter reportLogWriter,
    RestaurantOperatingHoursService restaurantOperatingHoursService,
    TableSessionService tableSessionService,
    StripeOrderCheckoutService stripeOrderCheckoutService,
    IStripeClient stripeClient,
    IOptions<StripeOptions> stripeOptions,
    CartTokenFailureTracker cartTokenFailureTracker,
    ILogger<PublicCartsController> logger) : ControllerBase
{
    /// <summary>
    /// Trims a declaration and treats whitespace as nothing declared, so a snapshot never records
    /// a blank that reads as a declaration nobody made.
    /// </summary>
    private static string? NormalizeDisclosureSnapshot(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private const string ParticipantTokenHeader = "X-Cart-Participant-Token";
    private const string IdempotencyKeyHeader = "Idempotency-Key";
    private const int MaximumIdempotencyKeyLength = 200;
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

        if (hasTableToken &&
            !string.IsNullOrWhiteSpace(request.OrderType) &&
            !request.OrderType.Equals(nameof(OrderType.DineIn), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Table QR ordering only supports DineIn." });
        }

        // A table QR is unambiguous — it is dine-in by definition. Joining by restaurant is not, and
        // the default here used to be Takeaway: a request that named no type was answered 200 with
        // a takeaway cart nobody had chosen. For a restaurant offering both, that is a guess about
        // how the customer intends to eat, and it changes what they are quoted and how the kitchen
        // treats the order. Better to refuse and let the caller ask.
        var requestedOrderType = OrderType.DineIn;

        if (hasRestaurantId)
        {
            if (string.IsNullOrWhiteSpace(request.OrderType))
            {
                return BadRequest(new
                {
                    message = "Choose how you would like to order before starting a cart.",
                    code = "order_type_required",
                    allowedOrderTypes = new[] { nameof(OrderType.DineIn), nameof(OrderType.Takeaway) }
                });
            }

            if (!Enum.TryParse<OrderType>(request.OrderType, true, out requestedOrderType) ||
                requestedOrderType is not (OrderType.DineIn or OrderType.Takeaway))
            {
                return BadRequest(new
                {
                    message = "OrderType must be DineIn or Takeaway.",
                    code = "order_type_invalid",
                    allowedOrderTypes = new[] { nameof(OrderType.DineIn), nameof(OrderType.Takeaway) }
                });
            }
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

            var restaurant = await dbContext.Restaurants
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    restaurant => restaurant.Id == table.RestaurantId && restaurant.IsActive,
                    cancellationToken);

            if (restaurant is null)
            {
                return NotFound(new { message = "Restaurant is not available for ordering." });
            }

            var unavailableResult = EnsureRestaurantCanAcceptOrders(restaurant);
            if (unavailableResult is not null)
            {
                return unavailableResult;
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

            var tableSession = await tableSessionService.GetOrCreateOpenSessionAsync(
                table.RestaurantId,
                table.Id,
                now,
                cancellationToken);

            cart = activeCart ?? new Cart
            {
                Id = Guid.NewGuid(),
                RestaurantId = table.RestaurantId,
                TableId = table.Id,
                TableSessionId = tableSession.Id,
                OrderType = OrderType.DineIn,
                Status = CartStatus.Active,
                ExpiresAt = now.Add(DineInCartLifetime),
                CreatedAt = now
            };

            if (activeCart is null)
            {
                await dbContext.Carts.AddAsync(cart, cancellationToken);
            }
            else if (activeCart.TableSessionId != tableSession.Id)
            {
                activeCart.TableSessionId = tableSession.Id;
                activeCart.UpdatedAt = now;
            }
        }
        else
        {
            var restaurantId = request.RestaurantId!.Value;
            var restaurant = await dbContext.Restaurants
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    restaurant => restaurant.Id == restaurantId && restaurant.IsActive,
                    cancellationToken);

            if (restaurant is null)
            {
                return NotFound(new { message = "Restaurant is not available for ordering." });
            }

            var unavailableResult = EnsureRestaurantCanAcceptOrders(restaurant);
            if (unavailableResult is not null)
            {
                return unavailableResult;
            }

            // The table branch above reuses a table's open cart; this one always made a new one.
            // So a signed-in customer pressing "Order again" twice ended up with two active carts
            // for the same restaurant, the second one on screen and the first left in the database
            // holding items nobody would ever see again.
            //
            // Only resolvable for a signed-in customer: a guest is identified by the participant
            // token their browser is holding, and a request that arrives without one is, as far as
            // the server can tell, a different person.
            var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var existingCart = string.IsNullOrWhiteSpace(currentUserId)
                ? null
                : await FindResumableCartAsync(restaurantId, requestedOrderType, currentUserId, now, cancellationToken);

            cart = existingCart ?? new Cart
            {
                Id = Guid.NewGuid(),
                RestaurantId = restaurantId,
                TableId = null,
                OrderType = requestedOrderType,
                Status = CartStatus.Active,
                ExpiresAt = now.Add(requestedOrderType == OrderType.DineIn ? DineInCartLifetime : TakeawayCartLifetime),
                CreatedAt = now
            };

            if (existingCart is null)
            {
                await dbContext.Carts.AddAsync(cart, cancellationToken);
            }
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
            ParticipantId = participant.Id,
            Cart = snapshot!
        });
    }

    /// <summary>
    /// This customer's open cart for the same restaurant and ordering mode, or null when they have
    /// none. Matched through the participant rows, which are what tie a cart to an account.
    /// </summary>
    private async Task<Cart?> FindResumableCartAsync(
        Guid restaurantId,
        OrderType orderType,
        string customerId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        return await dbContext.Carts
            .Where(cart =>
                cart.RestaurantId == restaurantId &&
                cart.TableId == null &&
                cart.OrderType == orderType &&
                cart.Status == CartStatus.Active &&
                cart.ExpiresAt > now &&
                dbContext.CartParticipants.Any(participant =>
                    participant.CartId == cart.Id && participant.CustomerId == customerId))
            // Newest first: if earlier data left more than one behind, resuming the most recent is
            // the one the customer last saw.
            .OrderByDescending(cart => cart.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);
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
        [FromHeader(Name = IdempotencyKeyHeader)] string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var validationError = ValidateItem(request.Quantity, request.Note);

        if (validationError is not null)
        {
            return BadRequest(new { message = validationError });
        }

        if (idempotencyKey is { Length: > MaximumIdempotencyKeyLength })
        {
            return BadRequest(new
            {
                message = $"{IdempotencyKeyHeader} must not exceed {MaximumIdempotencyKeyLength} characters."
            });
        }

        // Adding is the one cart operation that is not repeatable — it adds to whatever is already
        // there. The claim below and the mutation share this transaction, so the key is recorded if
        // and only if the quantity moved.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        // Everything below reads the cart's lines, decides, and writes back. Ten callers doing that
        // at once all read the same "before" and all wrote the same "after", so nine of ten adds
        // vanished while every one of them was answered 200. Serialising per cart is the fix: the
        // contention is one customer, or one table, and correctness is worth more than the wait.
        await LockCartAsync(cartId, cancellationToken);

        if (!await TryClaimMutationAsync(cartId, idempotencyKey, cancellationToken))
        {
            // This exact add already happened. The caller is retrying because it never heard back,
            // so answer with the cart as it stands rather than adding again.
            await transaction.CommitAsync(cancellationToken);

            var replayed = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);

            return replayed is null
                ? NotFound(new { message = "Cart not found." })
                : Ok(replayed);
        }

        var cart = access.Cart!;
        var menuItem = await dbContext.MenuItems
            .AsNoTracking()
            .Include(item => item.Category)
            .Include(item => item.OptionGroups.Where(group => group.IsActive))
                .ThenInclude(group => group.Options.Where(option => option.IsAvailable))
            .Where(item =>
                item.Id == request.MenuItemId &&
                item.RestaurantId == cart.RestaurantId &&
                item.IsAvailable &&
                !item.IsSoldOut)
            .FirstOrDefaultAsync(cancellationToken);

        if (menuItem is null ||
            menuItem.Category is null ||
            menuItem.Category.RestaurantId != cart.RestaurantId ||
            !menuItem.Category.IsActive)
        {
            return Conflict(new { message = "Menu item is unavailable, sold out, or belongs to another restaurant." });
        }

        var optionSelection = ValidateOptionSelection(menuItem, request.SelectedOptionIds);

        if (optionSelection.Errors.Count > 0)
        {
            return BadRequest(new { message = string.Join(" ", optionSelection.Errors) });
        }

        // Checked before the cart is touched. Stock is only reserved at checkout, so this cannot
        // promise the portions will still be there — but it stops a customer choosing options and
        // pressing pay on a dish the menu could already tell them is nearly gone.
        var alreadyInCart = await dbContext.CartItems
            .Where(item => item.CartId == cartId && item.MenuItemId == request.MenuItemId)
            .SumAsync(item => item.Quantity, cancellationToken);
        var stockLimit = CartStockLimit.Evaluate(menuItem.StockQuantity, alreadyInCart, request.Quantity);

        if (!stockLimit.IsAllowed)
        {
            return Conflict(new
            {
                message = stockLimit.DescribeRefusal(menuItem.Name),
                code = "insufficient_stock",
                remaining = stockLimit.Remaining,
                alreadyInCart = stockLimit.AlreadyInCart
            });
        }

        // Modifiers run out too, and until this check existed the cart only found out at payment.
        // Same warning as the dish above, for the same reason: said while it can still be changed.
        var trackedOptions = optionSelection.SelectedOptions
            .Select(selection => new CartOptionStockLimit.Request(
                selection.Option.Id,
                selection.Option.Name,
                selection.Option.StockQuantity,
                selection.Quantity))
            .ToList();

        if (trackedOptions.Exists(option => option.StockQuantity is not null))
        {
            var optionUnitsInCart = CartOptionStockLimit.UnitsInCart(await dbContext.CartItems
                .Where(item => item.CartId == cartId)
                .ToListAsync(cancellationToken));
            var optionShortages = CartOptionStockLimit.Evaluate(
                trackedOptions,
                request.Quantity,
                optionUnitsInCart);

            if (optionShortages.Count > 0)
            {
                return Conflict(new
                {
                    message = CartOptionStockLimit.DescribeRefusal(optionShortages),
                    code = "insufficient_option_stock"
                });
            }
        }

        var note = NormalizeNote(request.Note);
        var selectedOptionIds = optionSelection.SelectedOptions
            .SelectMany(selection => Enumerable.Repeat(selection.Option.Id, selection.Quantity))
            .ToArray();
        var matchingLines = await dbContext.CartItems
            .Where(item => item.CartId == cartId && item.MenuItemId == request.MenuItemId && item.Note == note)
            .ToListAsync(cancellationToken);
        var existingLine = matchingLines.FirstOrDefault(item =>
            OptionIdsEqual(item.SelectedOptionIds, selectedOptionIds));

        if (existingLine is null)
        {
            await dbContext.CartItems.AddAsync(new CartItem
            {
                Id = Guid.NewGuid(),
                CartId = cartId,
                MenuItemId = request.MenuItemId,
                Quantity = request.Quantity,
                Note = note,
                SelectedOptionIds = selectedOptionIds,
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
        await transaction.CommitAsync(cancellationToken);

        var snapshot = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);

        if (snapshot is null)
        {
            return NotFound(new { message = "Cart not found." });
        }

        await cartRealtimeNotifier.CartUpdatedAsync(
            cartId,
            "item-added",
            snapshot,
            cancellationToken);

        await cartRealtimeNotifier.CartItemAddedAsync(
            cartId,
            access.Participant.Id,
            GetParticipantDisplayName(access.Participant),
            menuItem.Name,
            request.Quantity,
            cancellationToken);

        return Ok(snapshot);
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

        // The version check below compares what the caller saw against what is stored. Without the
        // lock, two simultaneous edits both read the same version, both pass the check and both
        // write — which is the very thing the check exists to catch. The lock makes the read, the
        // check and the write one step; the version turns a *stale* edit into a conflict.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        await LockCartAsync(cartId, cancellationToken);

        var item = await dbContext.CartItems.FirstOrDefaultAsync(
            cartItem => cartItem.Id == cartItemId && cartItem.CartId == cartId,
            cancellationToken);

        if (item is null)
        {
            return NotFound(new { message = "Cart item not found." });
        }

        if (request.ExpectedUpdatedAt is null)
        {
            return BadRequest(new
            {
                message = "This edit is missing the line version it was based on, so it cannot be "
                    + "checked against changes made by anyone else. Reload the cart and try again.",
                code = "missing_expected_version"
            });
        }

        // The cart is shared, and this edit sets an absolute quantity rather than adjusting one, so
        // the loser of a race does not lose part of their change — they lose all of it, silently.
        if (CartItemWasChangedElsewhere(item, request.ExpectedUpdatedAt.Value))
        {
            var current = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);

            return Conflict(new
            {
                message = "Someone else changed this item while you were editing it. "
                    + "Here is the cart as it stands now.",
                code = "cart_item_conflict",
                currentUpdatedAt = CartItemVersionOf(item),
                cart = current
            });
        }

        var note = NormalizeNote(request.Note);
        var selectedOptionIds = item.SelectedOptionIds;

        if (request.SelectedOptionIds is not null)
        {
            var menuItem = await dbContext.MenuItems
                .AsNoTracking()
                .Include(menuItem => menuItem.Category)
                .Include(menuItem => menuItem.OptionGroups.Where(group => group.IsActive))
                    .ThenInclude(group => group.Options.Where(option => option.IsAvailable))
                .Where(menuItem =>
                    menuItem.Id == item.MenuItemId &&
                    menuItem.RestaurantId == access.Cart!.RestaurantId &&
                    menuItem.IsAvailable &&
                    !menuItem.IsSoldOut)
                .FirstOrDefaultAsync(cancellationToken);

            if (menuItem is null ||
                menuItem.Category is null ||
                menuItem.Category.RestaurantId != access.Cart!.RestaurantId ||
                !menuItem.Category.IsActive)
            {
                return Conflict(new { message = "Menu item is unavailable, sold out, or belongs to another restaurant." });
            }

            var optionSelection = ValidateOptionSelection(menuItem, request.SelectedOptionIds);

            if (optionSelection.Errors.Count > 0)
            {
                return BadRequest(new { message = string.Join(" ", optionSelection.Errors) });
            }

            selectedOptionIds = optionSelection.SelectedOptions
                .SelectMany(selection => Enumerable.Repeat(selection.Option.Id, selection.Quantity))
                .ToArray();
        }

        // Same warning the add path gives, for the other way a quantity can grow. This edit sets an
        // absolute quantity, so what the rest of the cart holds is what counts as "already there".
        var stockQuantity = await dbContext.MenuItems
            .Where(menuItem => menuItem.Id == item.MenuItemId)
            .Select(menuItem => new { menuItem.StockQuantity, menuItem.Name })
            .FirstOrDefaultAsync(cancellationToken);

        if (stockQuantity is not null)
        {
            var elsewhereInCart = await dbContext.CartItems
                .Where(cartItem =>
                    cartItem.CartId == cartId &&
                    cartItem.Id != cartItemId &&
                    cartItem.MenuItemId == item.MenuItemId)
                .SumAsync(cartItem => cartItem.Quantity, cancellationToken);
            var stockLimit = CartStockLimit.Evaluate(
                stockQuantity.StockQuantity,
                elsewhereInCart,
                request.Quantity);

            if (!stockLimit.IsAllowed)
            {
                return Conflict(new
                {
                    message = stockLimit.DescribeRefusal(stockQuantity.Name),
                    code = "insufficient_stock",
                    remaining = stockLimit.Remaining,
                    alreadyInCart = stockLimit.AlreadyInCart
                });
            }
        }

        // A quantity change multiplies the modifiers along with the dish, so this runs whether or
        // not the options themselves were edited. Absolute quantity again: only the cart's other
        // lines count as already committed.
        var requestedOptionCounts = selectedOptionIds
            .GroupBy(optionId => optionId)
            .ToDictionary(group => group.Key, group => group.Count());

        if (requestedOptionCounts.Count > 0)
        {
            var requestedOptionIds = requestedOptionCounts.Keys.ToArray();
            var trackedOptions = await dbContext.MenuItemOptions
                .AsNoTracking()
                .Where(option => requestedOptionIds.Contains(option.Id) && option.StockQuantity != null)
                .Select(option => new { option.Id, option.Name, option.StockQuantity })
                .ToListAsync(cancellationToken);

            if (trackedOptions.Count > 0)
            {
                var optionUnitsElsewhere = CartOptionStockLimit.UnitsInCart(await dbContext.CartItems
                    .Where(cartItem => cartItem.CartId == cartId && cartItem.Id != cartItemId)
                    .ToListAsync(cancellationToken));
                var optionShortages = CartOptionStockLimit.Evaluate(
                    trackedOptions.Select(option => new CartOptionStockLimit.Request(
                        option.Id,
                        option.Name,
                        option.StockQuantity,
                        requestedOptionCounts[option.Id])),
                    request.Quantity,
                    optionUnitsElsewhere);

                if (optionShortages.Count > 0)
                {
                    return Conflict(new
                    {
                        message = CartOptionStockLimit.DescribeRefusal(optionShortages),
                        code = "insufficient_option_stock"
                    });
                }
            }
        }

        var matchingLines = await dbContext.CartItems
            .Where(cartItem =>
                cartItem.CartId == cartId &&
                cartItem.Id != cartItemId &&
                cartItem.MenuItemId == item.MenuItemId &&
                cartItem.Note == note)
            .ToListAsync(cancellationToken);
        var matchingLine = matchingLines.FirstOrDefault(cartItem =>
            OptionIdsEqual(cartItem.SelectedOptionIds, selectedOptionIds));

        if (matchingLine is not null)
        {
            if (matchingLine.Quantity + request.Quantity > MaximumItemQuantity)
            {
                return BadRequest(new { message = $"Item quantity cannot exceed {MaximumItemQuantity}." });
            }

            matchingLine.Quantity += request.Quantity;
            matchingLine.UpdatedAt = DateTime.UtcNow;
            dbContext.CartItems.Remove(item);
        }
        else
        {
            item.Quantity = request.Quantity;
            item.Note = note;
            item.SelectedOptionIds = selectedOptionIds;
            item.UpdatedAt = DateTime.UtcNow;
        }

        access.Cart!.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "item-updated", cancellationToken);
    }

    [HttpDelete("{cartId:guid}/items/{cartItemId:guid}")]
    public async Task<IActionResult> DeleteItem(
        Guid cartId,
        Guid cartItemId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        await LockCartAsync(cartId, cancellationToken);

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
        await transaction.CommitAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "item-removed", cancellationToken);
    }

    [HttpDelete("{cartId:guid}/items")]
    public async Task<IActionResult> ClearItems(
        Guid cartId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        await LockCartAsync(cartId, cancellationToken);

        var items = await dbContext.CartItems
            .Where(cartItem => cartItem.CartId == cartId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0)
        {
            await transaction.CommitAsync(cancellationToken);

            return await ReturnUpdatedCartAsync(cartId, "items-cleared", cancellationToken);
        }

        dbContext.CartItems.RemoveRange(items);
        access.Cart!.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "items-cleared", cancellationToken);
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

        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        await LockCartAsync(cartId, cancellationToken);

        access.Cart!.CustomerNote = NormalizeNote(request.Note);
        access.Cart.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return await ReturnUpdatedCartAsync(cartId, "note-updated", cancellationToken);
    }

    [HttpPost("{cartId:guid}/checkout")]
    public async Task<IActionResult> Checkout(
        Guid cartId,
        [FromBody] CheckoutCartRequest? request,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);

        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var cart = await dbContext.Carts
            .FromSqlInterpolated($"SELECT * FROM \"Carts\" WHERE \"Id\" = {cartId} FOR UPDATE")
            .FirstOrDefaultAsync(cancellationToken);

        if (cart is null)
        {
            return NotFound(new { message = "Cart not found." });
        }

        // The lock above did its job — a second caller waits here until the first commits — but the
        // values it returned were being thrown away. Authorization already loaded this cart, and a
        // tracked entity wins identity resolution: EF hands back the instance read *before* the
        // lock and leaves its properties alone. So the loser of the race woke up holding a snapshot
        // that still said Active with no order, and cheerfully placed a second one.
        await dbContext.Entry(cart).ReloadAsync(cancellationToken);

        if (cart.Status == CartStatus.Submitted && cart.OrderId.HasValue)
        {
            var existingOrder = await LoadOrderAsync(cart.OrderId.Value, cancellationToken);

            if (existingOrder is null)
            {
                return Conflict(new { message = "Cart was submitted but the order could not be found." });
            }

            // The secret is handed over exactly once, in a response that may be the one that never
            // arrived — which is precisely the situation this branch exists for. A guest recovering
            // their order would otherwise be able to pay for it and never look at it again, because
            // the only credential it had was lost in transit.
            //
            // Reissued rather than recovered: only the hash is kept, by design. Safe because the
            // caller has just proved the same cart participation that earned them the first one,
            // and they store what comes back — so the token they hold and the hash on the order
            // stay the same one.
            var reissued = string.IsNullOrWhiteSpace(existingOrder.CustomerId)
                ? GuestAccessTokenService.Issue()
                : default((string Token, string Hash)?);

            if (reissued is not null)
            {
                existingOrder.GuestAccessTokenHash = reissued.Value.Hash;
                existingOrder.UpdatedAt = DateTime.UtcNow;
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);

            return Ok(new CheckoutCartResponse
            {
                Message = "Order was already submitted.",
                Order = MapOrder(existingOrder),
                GuestAccessToken = reissued?.Token
            });
        }

        // Checked ahead of the generic "not active" test below. Between authorization and the lock
        // above, another request can expire this cart; without this, that timing decides whether
        // the caller is told "gone" or "no longer active" for one and the same reason.
        if (cart.Status == CartStatus.Expired)
        {
            return StatusCode(StatusCodes.Status410Gone, new { message = "Cart has expired." });
        }

        if (cart.Status != CartStatus.Active)
        {
            return Conflict(new { message = "Cart is no longer active." });
        }

        if (request is null ||
            request.AcceptedCustomerTermsVersion != LegalDocumentVersions.CustomerTerms ||
            request.AcknowledgedPrivacyPolicyVersion != LegalDocumentVersions.PrivacyPolicy ||
            request.AcknowledgedAllergenNoticeVersion != LegalDocumentVersions.AllergenNotice)
        {
            return BadRequest(new
            {
                message = "Accept the current Customer Terms and acknowledge the Privacy and Allergen notices before ordering.",
                requiredCustomerTermsVersion = LegalDocumentVersions.CustomerTerms,
                requiredPrivacyPolicyVersion = LegalDocumentVersions.PrivacyPolicy,
                requiredAllergenNoticeVersion = LegalDocumentVersions.AllergenNotice
            });
        }

        if (cart.ExpiresAt <= DateTime.UtcNow)
        {
            cart.Status = CartStatus.Expired;
            cart.UpdatedAt = DateTime.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            await cartRealtimeNotifier.CartExpiredAsync(cartId, cancellationToken);

            return StatusCode(StatusCodes.Status410Gone, new { message = "Cart has expired." });
        }

        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(
                restaurant => restaurant.Id == cart.RestaurantId && restaurant.IsActive,
                cancellationToken);

        var tableIsActive = !cart.TableId.HasValue || await dbContext.RestaurantTables
            .AsNoTracking()
            .AnyAsync(
                table => table.Id == cart.TableId.Value &&
                    table.RestaurantId == cart.RestaurantId &&
                    table.IsActive,
                cancellationToken);

        if (restaurant is null || !tableIsActive)
        {
            return Conflict(new { message = "Restaurant or table is no longer available for ordering." });
        }

        var unavailableResult = EnsureRestaurantCanAcceptOrders(restaurant);
        if (unavailableResult is not null)
        {
            return unavailableResult;
        }

        if (restaurant.PaymentPolicy == RestaurantPaymentPolicy.PrepayRequired &&
            (string.IsNullOrWhiteSpace(restaurant.StripeAccountId) ||
             !restaurant.StripeChargesEnabled))
        {
            return Conflict(new
            {
                message = "This restaurant cannot accept prepaid orders until Stripe setup is complete."
            });
        }

        TableSession? tableSession = null;
        if (cart.TableId.HasValue)
        {
            if (cart.TableSessionId.HasValue)
            {
                tableSession = await dbContext.TableSessions
                    .FirstOrDefaultAsync(
                        session =>
                            session.Id == cart.TableSessionId.Value &&
                            session.RestaurantId == cart.RestaurantId &&
                            session.TableId == cart.TableId.Value &&
                            session.Status == TableSessionStatus.Open,
                        cancellationToken);
            }

            tableSession ??= await tableSessionService.GetOrCreateOpenSessionAsync(
                cart.RestaurantId,
                cart.TableId.Value,
                DateTime.UtcNow,
                cancellationToken);

            cart.TableSessionId = tableSession.Id;
        }

        var cartItems = await dbContext.CartItems
            .Where(item => item.CartId == cartId)
            .OrderBy(item => item.CreatedAt)
            .ToListAsync(cancellationToken);

        if (cartItems.Count == 0)
        {
            return BadRequest(new { message = "Cart is empty." });
        }

        var menuItemIds = cartItems
            .Select(item => item.MenuItemId)
            .Distinct()
            .ToList();

        var menuItems = await dbContext.MenuItems
            .AsNoTracking()
            .Include(item => item.Category)
            .Include(item => item.OptionGroups.Where(group => group.IsActive))
                .ThenInclude(group => group.Options.Where(option => option.IsAvailable))
            .Where(item => menuItemIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        var now = DateTime.UtcNow;
        // The signed-in caller, or nobody. This used to fall back to the participant's stored
        // customer, which is how an anonymous request ended up placing an order under the account
        // that had used this tab earlier. Authorization now refuses that combination outright, and
        // taking the identity from the request alone means an order can never name someone who is
        // not the one making it.
        var orderCustomerId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        // Only orders with nobody signed in behind them need a bearer secret; for everyone else the
        // account itself is the credential.
        var guestAccess = string.IsNullOrWhiteSpace(orderCustomerId)
            ? GuestAccessTokenService.Issue()
            : default((string Token, string Hash)?);

        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = cart.RestaurantId,
            // Claims the cart. The unique index on this column is the last line of defence against
            // one cart becoming two orders.
            CartId = cart.Id,
            TableId = cart.TableId,
            TableSessionId = tableSession?.Id,
            CustomerId = orderCustomerId,
            AcceptedCustomerTermsVersion = request.AcceptedCustomerTermsVersion,
            AcknowledgedPrivacyPolicyVersion = request.AcknowledgedPrivacyPolicyVersion,
            AcknowledgedAllergenNoticeVersion = request.AcknowledgedAllergenNoticeVersion,
            LegalAcceptedAt = DateTime.UtcNow,
            LegalAcceptanceIpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            LegalAcceptanceUserAgent = Request.Headers.UserAgent.ToString(),
            GuestAccessTokenHash = guestAccess?.Hash,
            OrderNumber = await GenerateOrderNumberAsync(cancellationToken),
            OrderType = cart.OrderType,
            Status = OrderStatus.Pending,
            PaymentStatus = PaymentStatus.Unpaid,
            PaymentMethod = PaymentMethod.Online,
            CustomerNote = cart.CustomerNote,
            CreatedAt = now
        };

        foreach (var cartItem in cartItems)
        {
            menuItems.TryGetValue(cartItem.MenuItemId, out var menuItem);

            // The same rule the cart snapshot reports, so a cart can never show a line as orderable
            // that this then refuses.
            var availability = CartLineAvailability.Evaluate(menuItem, cart.RestaurantId);

            // The null check is redundant with the verdict — an absent item is never orderable — but
            // it is what makes that provable to the compiler on the lines below.
            if (menuItem is null || !availability.IsOrderable)
            {
                return Conflict(new
                {
                    message = $"{menuItem?.Name ?? "An item in your cart"}: {availability.Reason}",
                    code = "cart_item_unavailable",
                    menuItemId = cartItem.MenuItemId
                });
            }

            var optionSelection = ValidateOptionSelection(menuItem, cartItem.SelectedOptionIds);

            if (optionSelection.Errors.Count > 0)
            {
                return Conflict(new
                {
                    message = $"Cart contains invalid options for '{menuItem.Name}'. {string.Join(" ", optionSelection.Errors)}"
                });
            }

            var orderItem = new OrderItem
            {
                Id = Guid.NewGuid(),
                MenuItemId = menuItem.Id,
                MenuItemNameSnapshot = menuItem.Name,
                // Frozen with the name and the price. A correction to the menu must not rewrite
                // what a past customer was shown.
                AllergensSnapshot = NormalizeDisclosureSnapshot(menuItem.Allergens),
                MayContainAllergensSnapshot = NormalizeDisclosureSnapshot(menuItem.MayContainAllergens),
                CrossContactStatementSnapshot = NormalizeDisclosureSnapshot(menuItem.CrossContactStatement),
                BasePriceSnapshot = menuItem.Price,
                Quantity = cartItem.Quantity,
                UnitPrice = optionSelection.UnitPrice,
                ItemInstructions = cartItem.Note,
                CreatedAt = now
            };

            foreach (var selectedOption in optionSelection.SelectedOptions)
            {
                var option = selectedOption.Option;
                var groupName = menuItem.OptionGroups
                    .First(group => group.Id == option.GroupId)
                    .Name;

                orderItem.SelectedOptions.Add(new OrderItemOption
                {
                    MenuItemOptionId = option.Id,
                    GroupNameSnapshot = groupName,
                    OptionNameSnapshot = option.Name,
                    PriceAdjustmentSnapshot = option.PriceAdjustment,
                    // Without this the adjustment above is a number with no unit: the same 3.00 is
                    // a surcharge, a discount or the whole price depending on a type that lived
                    // only on the menu row, which can be archived or edited afterwards.
                    AdjustmentTypeSnapshot = option.AdjustmentType,
                    // Frozen with the name and the price: a receipt has to say what the customer
                    // was told, not what the menu says today.
                    AllergensSnapshot = option.Allergens,
                    MayContainAllergensSnapshot = option.MayContainAllergens,
                    CrossContactStatementSnapshot = option.CrossContactStatement,
                    Quantity = selectedOption.Quantity,
                    CreatedAt = now
                });
            }

            order.OrderItems.Add(orderItem);
        }

        order.TotalAmount = PricingCalculator.CalculateTotal(order.OrderItems.Select(item => (item.Quantity, item.UnitPrice)));

        // Reserved inside the checkout transaction opened above, so a tracked item can't oversell
        // to two carts checking out at once.
        var unavailableItemIds = await menuItemStockService.TryReserveAsync(
            OrderController.BuildRequestedQuantities(order.OrderItems),
            cancellationToken);

        if (unavailableItemIds.Count > 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Conflict(new
            {
                message = "Some items sold out while the cart was being submitted.",
                items = OrderController.DescribeUnavailableItems(unavailableItemIds, order.OrderItems)
            });
        }

        // Same transaction as the dish. A cart that takes the last portion and finds its tracked
        // extra gone must take neither, or the kitchen owes a plate it cannot make.
        var unavailableOptionIds = await menuItemStockService.TryReserveOptionsAsync(
            OrderOptionStock.RequestedQuantities(order.OrderItems),
            cancellationToken);

        if (unavailableOptionIds.Count > 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return Conflict(new
            {
                message = "Some options sold out while the cart was being submitted.",
                options = OrderController.DescribeUnavailableOptions(unavailableOptionIds, order.OrderItems)
            });
        }

        await orderPickupNumberService.AssignPickupNumberAsync(order, restaurant, now, cancellationToken);
        cart.Status = CartStatus.Submitted;
        cart.OrderId = order.Id;
        cart.UpdatedAt = now;
        access.Participant!.LastSeenAt = now;

        await dbContext.Orders.AddAsync(order, cancellationToken);
        reportLogWriter.AddAudit(
            "Order.Created",
            "Order",
            order.Id.ToString(),
            order.RestaurantId,
            $"Order {order.OrderNumber} submitted from cart.",
            after: new
            {
                order.Id,
                order.OrderNumber,
                order.RestaurantId,
                order.TableId,
                order.CustomerId,
                order.OrderType,
                order.Status,
                order.PaymentStatus,
                order.PaymentMethod,
                order.TotalAmount,
                cartId
            });
        reportLogWriter.AddOrderEvent(
            order,
            "order.created",
            $"Order {order.OrderNumber} submitted from cart.",
            new
            {
                cartId,
                order.OrderType,
                order.Status,
                order.PaymentStatus,
                order.PaymentMethod,
                order.TotalAmount
            });
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsCartAlreadyOrderedViolation(exception))
        {
            // The unique index refused a second order for this cart. Reaching here means the lock
            // above was bypassed somehow, so the safe answer is the order that did commit — not an
            // error that would invite the caller to try again and keep trying.
            await transaction.RollbackAsync(cancellationToken);
            logger.LogWarning(
                exception,
                "A second checkout for cart {CartId} was stopped by the database, not by the cart lock.",
                cartId);

            var committed = await FindOrderForCartAsync(cartId, cancellationToken);

            if (committed is null)
            {
                return Conflict(new { message = "This cart was already submitted, but its order could not be loaded." });
            }

            return Ok(new CheckoutCartResponse
            {
                Message = "Order was already submitted.",
                Order = MapOrder(committed)
            });
        }

        var submittedOrder = await LoadOrderAsync(order.Id, cancellationToken);
        var cartSnapshot = await cartAccessService.LoadSnapshotAsync(cartId, cancellationToken);
        var orderResponse = MapOrder(submittedOrder!);

        await orderRealtimeNotifier.OrderCreatedAsync(submittedOrder!, cancellationToken);

        if (cartSnapshot is not null)
        {
            await cartRealtimeNotifier.CartSubmittedAsync(
                cartId,
                cartSnapshot,
                orderResponse,
                cancellationToken);
        }

        return Ok(new CheckoutCartResponse
        {
            Message = "Order submitted.",
            Order = orderResponse,
            // The one and only time the plaintext leaves the server.
            GuestAccessToken = guestAccess?.Token
        });
    }

    /// <summary>
    /// True when the write failed because this cart already has an order, rather than for any
    /// other reason. Matched on the index name so an unrelated constraint is never swallowed.
    /// </summary>
    private static bool IsCartAlreadyOrderedViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: "23505" } postgres &&
        string.Equals(postgres.ConstraintName, "IX_Orders_CartId_Unique", StringComparison.Ordinal);

    /// <summary>The order this cart already produced, read outside the failed transaction.</summary>
    private async Task<Order?> FindOrderForCartAsync(Guid cartId, CancellationToken cancellationToken)
    {
        var orderId = await dbContext.Orders
            .AsNoTracking()
            .Where(order => order.CartId == cartId)
            .Select(order => (Guid?)order.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return orderId is null ? null : await LoadOrderAsync(orderId.Value, cancellationToken);
    }

    /// <summary>
    /// A cart line's version. A line nobody has edited yet has no <c>UpdatedAt</c>, and treating
    /// that as "nothing to compare" would leave a just-added line unprotected — which is exactly
    /// when two people at a table are most likely to be adjusting the same thing.
    /// </summary>
    private static DateTime CartItemVersionOf(CartItem item) => item.UpdatedAt ?? item.CreatedAt;

    /// <summary>
    /// True when the line has moved on since the editor loaded it. Compared to the millisecond
    /// because the value makes a round trip through JSON, and a comparison tight enough to fail on
    /// a rounding difference would reject every edit.
    /// </summary>
    private static bool CartItemWasChangedElsewhere(CartItem item, DateTime expectedUpdatedAt) =>
        Math.Abs((CartItemVersionOf(item) - expectedUpdatedAt).TotalMilliseconds) > 1;

    /// <summary>
    /// Holds this cart against other writers until the transaction ends.
    ///
    /// <para>
    /// Deliberately <c>AsNoTracking</c>: authorization has already loaded this cart, and a tracked
    /// entity wins identity resolution, so a tracking query here would hand back the instance read
    /// before the lock and quietly discard the row the lock just re-read. Nothing needs the values
    /// — only the lock.
    /// </para>
    /// </summary>
    private Task LockCartAsync(Guid cartId, CancellationToken cancellationToken) =>
        dbContext.Carts
            .FromSqlInterpolated($"SELECT * FROM \"Carts\" WHERE \"Id\" = {cartId} FOR UPDATE")
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// Claims this key for this cart, or reports that it has already been used.
    ///
    /// <para>
    /// The insert is the decision. Reading first and inserting after would leave a window where two
    /// retries both see nothing and both proceed — which is the very situation being defended
    /// against. A concurrent retry blocks on the unique index until the first transaction commits
    /// and then loses, exactly as a later retry does.
    /// </para>
    ///
    /// <para>A caller that sends no key gets the old behaviour: nothing to match, nothing claimed.</para>
    /// </summary>
    private async Task<bool> TryClaimMutationAsync(
        Guid cartId,
        string? idempotencyKey,
        CancellationToken cancellationToken)
    {
        var key = idempotencyKey?.Trim();

        if (string.IsNullOrEmpty(key))
        {
            return true;
        }

        var inserted = await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO "CartMutations" ("Id", "CartId", "IdempotencyKey", "CreatedAt")
             VALUES ({Guid.NewGuid()}, {cartId}, {key}, {DateTime.UtcNow})
             ON CONFLICT ("CartId", "IdempotencyKey") DO NOTHING
             """,
            cancellationToken);

        return inserted == 1;
    }

    [HttpPut("{cartId:guid}/payment-method")]
    public async Task<IActionResult> SelectPaymentMethod(
        Guid cartId,
        SelectOrderPaymentMethodRequest request,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        if (!Enum.TryParse<PaymentMethod>(request.PaymentMethod, true, out var paymentMethod) ||
            !Enum.IsDefined(paymentMethod))
        {
            return BadRequest(new
            {
                message = $"PaymentMethod must be one of: {string.Join(", ", Enum.GetNames<PaymentMethod>())}."
            });
        }

        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var cart = access.Cart!;
        if (cart.Status != CartStatus.Submitted || !cart.OrderId.HasValue)
        {
            return Conflict(new { message = "Cart must be checked out before selecting payment." });
        }

        var order = await dbContext.Orders
            .Include(item => item.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(item => item.Payments)
            .Include(item => item.Restaurant)
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == cart.OrderId.Value, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        // Shared with the order-level route so the two cannot drift on what is allowed.
        var refusal = OrderPaymentMethodPolicy.Refuse(order, paymentMethod);

        if (refusal is not null)
        {
            return Conflict(new { message = refusal });
        }

        order.PaymentMethod = paymentMethod;
        order.PaymentStatus = PaymentStatus.Unpaid;
        order.UpdatedAt = DateTime.UtcNow;
        await orderAutoAcceptanceService.TryAcceptAsync(order, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

        return Ok(new CheckoutCartResponse
        {
            Message = paymentMethod == PaymentMethod.PayAtCounter
                ? "Pay at counter selected."
                : "Online payment selected.",
            Order = MapOrder(order)
        });
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

        var restaurant = await dbContext.Restaurants
            .AsNoTracking()
            .FirstOrDefaultAsync(
                restaurant => restaurant.Id == access.Cart.RestaurantId && restaurant.IsActive,
                cancellationToken);

        var tableIsActive = !access.Cart.TableId.HasValue || await dbContext.RestaurantTables
            .AsNoTracking()
            .AnyAsync(
                table => table.Id == access.Cart.TableId.Value && table.IsActive,
                cancellationToken);

        if (restaurant is null || !tableIsActive)
        {
            return access with
            {
                ErrorResult = Conflict(new { message = "Restaurant or table is no longer available for ordering." })
            };
        }

        var unavailableResult = EnsureRestaurantCanAcceptOrders(restaurant);
        if (unavailableResult is not null)
        {
            return access with
            {
                ErrorResult = unavailableResult
            };
        }

        return access;
    }

    private IActionResult? EnsureRestaurantCanAcceptOrders(Restaurant restaurant)
    {
        var availability = restaurantOperatingHoursService.GetAvailability(restaurant);

        return availability.IsOrderingAvailable
            ? null
            : Conflict(new
            {
                message = availability.Message,
                reason = availability.Reason
            });
    }

    private async Task<CartAccessResult> AuthorizeCartAsync(
        Guid cartId,
        string? participantToken,
        CancellationToken cancellationToken)
    {
        var source = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        var access = await cartAccessService.AuthorizeAsync(
            cartId,
            participantToken,
            cancellationToken);

        // The lockout is applied to the *outcome*, not to the request. Checking it before the
        // lookup was cheaper and wrong: an attacker on a restaurant's own wifi could spend the
        // budget deliberately and take every diner behind that address offline with them. Someone
        // holding a real token is, by definition, not the source this is defending against — so
        // they are let through no matter what anyone else on their connection has been doing.
        if (access.Failure == CartAccessFailure.InvalidToken)
        {
            cartTokenFailureTracker.RecordFailure(source);

            if (cartTokenFailureTracker.IsLockedOut(source))
            {
                return new CartAccessResult(null, null, StatusCode(
                    StatusCodes.Status429TooManyRequests,
                    new
                    {
                        message = "Too many invalid cart links from this connection. Wait a few minutes and try again.",
                        code = "cart_token_attempts_exceeded"
                    }));
            }
        }
        else if (access.Failure == CartAccessFailure.None)
        {
            // Holding a real token proves this is not the source the budget is for.
            cartTokenFailureTracker.Clear(source);
        }

        // Only the request that actually expired it announces the fact; the rest are simply told.
        if (access.JustExpired)
        {
            await cartRealtimeNotifier.CartExpiredAsync(cartId, cancellationToken);
        }

        if (access.Failure == CartAccessFailure.None && access.Participant is not null)
        {
            var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
            var participantOwner = access.Participant.CustomerId;
            var participantIsOwned = !string.IsNullOrWhiteSpace(participantOwner);
            var callerIsSignedIn = !string.IsNullOrWhiteSpace(currentUserId);

            // A participant that belongs to an account may only be used by that account. This used
            // to handle one direction only — a guest signing in claimed their own participant — and
            // said nothing about the reverse. So after logging out, the tab kept sending the same
            // token, the participant stayed bound to the account that had signed out, and the order
            // it eventually placed was attributed to them: their name and address surfaced in the
            // restaurant's order list, under a session the browser was labelling "Guest".
            //
            // The same check covers a second account picking the token up, which would otherwise
            // silently transfer the first one's cart.
            if (participantIsOwned &&
                !string.Equals(participantOwner, currentUserId, StringComparison.Ordinal))
            {
                return new CartAccessResult(
                    access.Cart,
                    null,
                    Unauthorized(new
                    {
                        message = callerIsSignedIn
                            ? "This cart belongs to a different account. Start a new one to keep ordering."
                            : "You have signed out, so this cart is no longer yours. Start a new one to order as a guest.",
                        code = "participant_identity_changed"
                    }));
            }

            // A guest who signs in claims the participant they have been using. Only ever null to
            // non-null: the branch above has already rejected any actual change of owner.
            if (callerIsSignedIn && !participantIsOwned)
            {
                access.Participant.CustomerId = currentUserId;
                access.Participant.LastSeenAt = DateTime.UtcNow;
                await dbContext.SaveChangesAsync(cancellationToken);
                var customerReference = dbContext.Entry(access.Participant)
                    .Reference(participant => participant.Customer);
                customerReference.IsLoaded = false;
                await customerReference.LoadAsync(cancellationToken);
            }
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

    private static string GetParticipantDisplayName(CartParticipant participant)
    {
        if (!string.IsNullOrWhiteSpace(participant.Customer?.FullName))
        {
            return participant.Customer.FullName;
        }

        if (!string.IsNullOrWhiteSpace(participant.Customer?.Email))
        {
            return participant.Customer.Email;
        }

        return "Someone";
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

    private async Task<string> GenerateOrderNumberAsync(CancellationToken cancellationToken)
    {
        string orderNumber;

        do
        {
            orderNumber = $"ORD-{DateTime.UtcNow:yyyyMMdd}-{RandomNumberGenerator.GetInt32(0, 1_000_000):D6}";
        }
        while (await dbContext.Orders.AnyAsync(order => order.OrderNumber == orderNumber, cancellationToken));

        return orderNumber;
    }

    private async Task<Order?> LoadOrderAsync(Guid orderId, CancellationToken cancellationToken)
    {
        return await dbContext.Orders
            .AsNoTracking()
            .Include(order => order.OrderItems)
                .ThenInclude(item => item.SelectedOptions)
            .Include(order => order.Restaurant)
            .Include(order => order.Table)
            .FirstOrDefaultAsync(order => order.Id == orderId, cancellationToken);
    }

    private static OrderResponse MapOrder(Order order)
    {
        return new OrderResponse
        {
            Id = order.Id,
            RestaurantId = order.RestaurantId,
            TableId = order.TableId,
            TableNumber = order.Table?.TableNumber,
            CustomerId = order.CustomerId,
            OrderNumber = order.OrderNumber,
            PickupDate = order.PickupDate,
            PickupNumber = order.PickupNumber,
            PickupCode = OrderPickupNumberService.FormatPickupCode(order.PickupNumber),
            Currency = string.IsNullOrWhiteSpace(order.Restaurant?.Currency) ? "AUD" : order.Restaurant.Currency,
            OrderType = (int)order.OrderType,
            Status = (int)order.Status,
            PaymentStatus = order.PaymentStatus.ToString(),
            PaymentMethod = order.PaymentMethod.ToString(),
            TotalAmount = order.TotalAmount,
            CustomerNote = order.CustomerNote,
            ScheduledTime = order.ScheduledTime,
            CreatedAt = order.CreatedAt,
            UpdatedAt = order.UpdatedAt,
            OrderItems = order.OrderItems
                .OrderBy(item => item.CreatedAt)
                .Select(item => new OrderItemResponse
                {
                    Id = item.Id,
                    OrderId = item.OrderId,
                    MenuItemId = item.MenuItemId,
                    MenuItemNameSnapshot = item.MenuItemNameSnapshot,
                    AllergensSnapshot = item.AllergensSnapshot,
                    MayContainAllergensSnapshot = item.MayContainAllergensSnapshot,
                    CrossContactStatementSnapshot = item.CrossContactStatementSnapshot,
                    ItemNameSnapshot = item.MenuItemNameSnapshot,
                    BasePriceSnapshot = item.BasePriceSnapshot,
                    Quantity = item.Quantity,
                    UnitPrice = item.UnitPrice,
                    ItemInstructions = item.ItemInstructions,
                    Note = item.ItemInstructions,
                    AllergyInfo = item.AllergyInfo,
                    CreatedAt = item.CreatedAt,
                    UpdatedAt = item.UpdatedAt,
                    SelectedOptions = item.SelectedOptions.Select(option => new OrderItemOptionResponse
                    {
                        Id = option.Id,
                        MenuItemOptionId = option.MenuItemOptionId,
                        GroupNameSnapshot = option.GroupNameSnapshot,
                        OptionNameSnapshot = option.OptionNameSnapshot,
                        AllergensSnapshot = option.AllergensSnapshot,
                        MayContainAllergensSnapshot = option.MayContainAllergensSnapshot,
                        CrossContactStatementSnapshot = option.CrossContactStatementSnapshot,
                        PriceAdjustmentSnapshot = option.PriceAdjustmentSnapshot,
                        Quantity = option.Quantity
                    }).ToList()
                })
                .ToList()
        };
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

    private static bool OptionIdsEqual(IReadOnlyList<Guid> first, IReadOnlyList<Guid> second)
    {
        if (first.Count != second.Count)
        {
            return false;
        }

        for (var index = 0; index < first.Count; index++)
        {
            if (first[index] != second[index])
            {
                return false;
            }
        }

        return true;
    }

    private static CartOptionSelectionResult ValidateOptionSelection(
        MenuItem menuItem,
        IEnumerable<Guid>? selectedOptionIds)
    {
        var errors = new List<string>();
        var requestedOptionIds = (selectedOptionIds ?? [])
            .Where(optionId => optionId != Guid.Empty)
            .ToList();
        var requestedOptionCounts = requestedOptionIds
            .GroupBy(optionId => optionId)
            .ToDictionary(group => group.Key, group => group.Count());
        var optionGroups = menuItem.OptionGroups
            .OrderBy(group => group.DisplayOrder)
            .ThenBy(group => group.Name)
            .ToList();
        var availableOptions = optionGroups
            .SelectMany(group => group.Options)
            .ToDictionary(option => option.Id);

        foreach (var optionId in requestedOptionCounts.Keys)
        {
            if (!availableOptions.ContainsKey(optionId))
            {
                errors.Add($"Option {optionId} is not available for '{menuItem.Name}'.");
            }
        }

        var selectedOptions = optionGroups
            .SelectMany(group => group.Options
                .OrderBy(option => option.DisplayOrder)
                .ThenBy(option => option.Name))
            .Where(option => requestedOptionCounts.ContainsKey(option.Id))
            .Select(option => new SelectedMenuOption(option, requestedOptionCounts[option.Id]))
            .ToList();

        foreach (var selection in selectedOptions)
        {
            if (selection.Quantity > selection.Option.MaxQuantity)
            {
                errors.Add($"'{selection.Option.Name}' allows at most {selection.Option.MaxQuantity} per item.");
            }
        }

        foreach (var group in optionGroups)
        {
            var selectedInGroup = selectedOptions
                .Count(selection => selection.Option.GroupId == group.Id);

            if (group.IsRequired && selectedInGroup < group.MinSelections)
            {
                errors.Add($"'{group.Name}' requires at least {group.MinSelections} choice(s) for '{menuItem.Name}'.");
            }

            if (selectedInGroup > group.MaxSelections)
            {
                errors.Add($"'{group.Name}' allows at most {group.MaxSelections} choice(s) for '{menuItem.Name}'.");
            }
        }

        var unitPrice = PricingCalculator.CalculateUnitPrice(
            menuItem.Price,
            selectedOptions.Select(selection => new MenuOptionPriceSelection(selection.Option, selection.Quantity)));

        return new CartOptionSelectionResult(unitPrice, selectedOptions, errors);
    }

    [HttpPost("{cartId:guid}/payment-session")]
    public async Task<IActionResult> StartPaymentSession(
        Guid cartId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var cart = access.Cart!;
        if (cart.Status != CartStatus.Submitted || !cart.OrderId.HasValue)
        {
            return Conflict(new { message = "Cart must be checked out before payment." });
        }

        var order = await dbContext.Orders
            .AsNoTracking()
            .Include(item => item.Table)
            .FirstOrDefaultAsync(item => item.Id == cart.OrderId.Value, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        var result = await stripeOrderCheckoutService.StartAsync(
            order.Id,
            User.FindFirstValue(ClaimTypes.Email),
            BuildMenuReturnPath(order),
            cancellationToken);

        if (!result.IsSuccess)
        {
            return StatusCode(result.StatusCode, new
            {
                message = result.Message,
                detail = result.Detail
            });
        }

        return Ok(result.Response);
    }

    [NonAction]
    public async Task<IActionResult> CreatePaymentSession(
        Guid cartId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(stripeOptions.Value.SecretKey))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "Online payment is not configured. Please pay at the counter."
            });
        }

        var access = await AuthorizeCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var cart = access.Cart!;

        if (cart.Status != CartStatus.Submitted || !cart.OrderId.HasValue)
        {
            return Conflict(new { message = "Cart must be checked out before payment." });
        }

        var order = await dbContext.Orders
            .Include(o => o.OrderItems)
            .Include(o => o.Restaurant)
            .Include(o => o.Table)
            .FirstOrDefaultAsync(o => o.Id == cart.OrderId.Value, cancellationToken);

        if (order is null)
        {
            return NotFound(new { message = "Order not found." });
        }

        if (order.PaymentStatus == PaymentStatus.Paid)
        {
            return Conflict(new { message = "This order has already been paid." });
        }

        if (order.PaymentMethod != PaymentMethod.Online)
        {
            return Conflict(new { message = "This order is configured for payment at the counter." });
        }

        if (order.Status is OrderStatus.Cancelled or OrderStatus.Rejected)
        {
            return BadRequest(new { message = "This order cannot be paid." });
        }

        var currency = NormalizeStripeCurrency(order.Restaurant?.Currency ?? stripeOptions.Value.Currency);
        var payment = new Payment
        {
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            AmountCents = PricingCalculator.ToMinorCurrencyUnits(order.TotalAmount),
            Currency = currency,
            Status = PaymentStatus.Pending
        };

        dbContext.Payments.Add(payment);
        await dbContext.SaveChangesAsync(cancellationToken);

        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            SuccessUrl = AppendSessionId(AddReturnTo(stripeOptions.Value.SuccessUrl, BuildMenuReturnPath(order))),
            CancelUrl = AddReturnTo(stripeOptions.Value.CancelUrl, BuildMenuReturnPath(order)),
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
            Metadata = new Dictionary<string, string>
            {
                ["mode"] = "order",
                ["orderId"] = order.Id.ToString(),
                ["paymentId"] = payment.Id.ToString()
            },
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                Metadata = new Dictionary<string, string>
                {
                    ["mode"] = "order",
                    ["orderId"] = order.Id.ToString(),
                    ["paymentId"] = payment.Id.ToString()
                }
            }
        };

        try
        {
            var service = new SessionService(stripeClient);
            var session = await service.CreateAsync(sessionOptions, cancellationToken: cancellationToken);

            payment.ProviderCheckoutSessionId = session.Id;
            payment.ProviderPaymentIntentId = session.PaymentIntentId;
            payment.UpdatedAt = DateTime.UtcNow;
            order.PaymentStatus = PaymentStatus.Pending;
            order.UpdatedAt = DateTime.UtcNow;
            reportLogWriter.AddAudit(
                "Payment.CheckoutSessionCreated",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"Stripe checkout session created for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    sessionId = session.Id,
                    paymentIntentId = session.PaymentIntentId,
                    payment.AmountCents,
                    payment.Currency
                });
            reportLogWriter.AddPaymentEvent(
                order,
                payment,
                null,
                "checkout_session.created",
                session.Id,
                payment.Status.ToString(),
                "Stripe checkout session created.",
                new
                {
                    sessionId = session.Id,
                    paymentIntentId = session.PaymentIntentId,
                    payment.AmountCents,
                    payment.Currency
                });
            await dbContext.SaveChangesAsync(cancellationToken);
            await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

            return Ok(new CreateCheckoutSessionResponse
            {
                Message = "Checkout session created.",
                SessionId = session.Id,
                CheckoutUrl = session.Url,
                OrderId = order.Id,
                PaymentId = payment.Id
            });
        }
        catch (StripeException ex)
        {
            logger.LogError(ex, "Stripe failed to create checkout session for order {OrderId}.", order.Id);

            payment.Status = PaymentStatus.Failed;
            payment.FailureReason = ex.StripeError?.Message ?? ex.Message;
            payment.FailedAt = DateTime.UtcNow;
            payment.UpdatedAt = DateTime.UtcNow;
            order.PaymentStatus = PaymentStatus.Failed;
            order.UpdatedAt = DateTime.UtcNow;
            reportLogWriter.AddAudit(
                "Payment.CheckoutSessionFailed",
                "Order",
                order.Id.ToString(),
                order.RestaurantId,
                $"Stripe checkout session failed for {order.OrderNumber}.",
                after: new
                {
                    orderId = order.Id,
                    order.OrderNumber,
                    paymentId = payment.Id,
                    payment.AmountCents,
                    payment.Currency,
                    payment.FailureReason
                });
            reportLogWriter.AddPaymentEvent(
                order,
                payment,
                null,
                "checkout_session.failed",
                null,
                payment.Status.ToString(),
                "Stripe checkout session failed.",
                new
                {
                    payment.AmountCents,
                    payment.Currency,
                    payment.FailureReason
                });
            await dbContext.SaveChangesAsync(cancellationToken);
            await orderRealtimeNotifier.OrderPaymentUpdatedAsync(order, cancellationToken);

            return BadRequest(new
            {
                message = "Payment could not be started. Please try again.",
                detail = ex.StripeError?.Message ?? ex.Message
            });
        }
    }

    private static string NormalizeStripeCurrency(string? currency) =>
        string.IsNullOrWhiteSpace(currency) ? "aud" : currency.Trim().ToLowerInvariant();

    private static string BuildMenuReturnPath(Order order)
    {
        if (!string.IsNullOrWhiteSpace(order.Table?.QrToken))
        {
            return $"/table/{Uri.EscapeDataString(order.Table.QrToken)}";
        }

        if (!order.RestaurantId.HasValue)
        {
            return "/";
        }

        var menuPath = $"/r/{Uri.EscapeDataString(order.RestaurantId.Value.ToString())}/menu";
        var orderType = order.OrderType == OrderType.DineIn ? "DineIn" : "Takeaway";
        return QueryHelpers.AddQueryString(menuPath, "orderType", orderType);
    }

    private static string AddReturnTo(string url, string returnPath)
    {
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(returnPath))
        {
            return url;
        }

        return QueryHelpers.AddQueryString(url, "returnTo", returnPath);
    }

    private static string AppendSessionId(string url) =>
        StripeCheckoutReturnUrl.WithSessionId(url);

    private sealed record CartAccessResult(
        Cart? Cart,
        CartParticipant? Participant,
        IActionResult? ErrorResult);

    private sealed record CartOptionSelectionResult(
        decimal UnitPrice,
        IReadOnlyList<SelectedMenuOption> SelectedOptions,
        List<string> Errors);

    private sealed record SelectedMenuOption(MenuItemOption Option, int Quantity);
}
