using System.Data;
using System.Security.Claims;
using System.Security.Cryptography;
using DineFlow.Api.Contracts.Cart;
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
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Api.Controllers;

[ApiController]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[Route("api/public/carts")]
public class PublicCartsController(
    AppDbContext dbContext,
    CartAccessService cartAccessService,
    CartRealtimeNotifier cartRealtimeNotifier,
    OrderRealtimeNotifier orderRealtimeNotifier,
    IStripeClient stripeClient,
    IOptions<StripeOptions> stripeOptions,
    ILogger<PublicCartsController> logger) : ControllerBase
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

        if (hasTableToken &&
            !string.IsNullOrWhiteSpace(request.OrderType) &&
            !request.OrderType.Equals(nameof(OrderType.DineIn), StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { message = "Table QR ordering only supports DineIn." });
        }

        var requestedOrderType = OrderType.Takeaway;
        if (hasRestaurantId && !string.IsNullOrWhiteSpace(request.OrderType))
        {
            if (!Enum.TryParse<OrderType>(request.OrderType, true, out requestedOrderType) ||
                requestedOrderType is not (OrderType.DineIn or OrderType.Takeaway))
            {
                return BadRequest(new { message = "OrderType must be DineIn or Takeaway." });
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
                OrderType = requestedOrderType,
                Status = CartStatus.Active,
                ExpiresAt = now.Add(requestedOrderType == OrderType.DineIn ? DineInCartLifetime : TakeawayCartLifetime),
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
            ParticipantId = participant.Id,
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

    [HttpDelete("{cartId:guid}/items")]
    public async Task<IActionResult> ClearItems(
        Guid cartId,
        [FromHeader(Name = ParticipantTokenHeader)] string? participantToken,
        CancellationToken cancellationToken)
    {
        var access = await AuthorizeMutableCartAsync(cartId, participantToken, cancellationToken);

        if (access.ErrorResult is not null)
        {
            return access.ErrorResult;
        }

        var items = await dbContext.CartItems
            .Where(cartItem => cartItem.CartId == cartId)
            .ToListAsync(cancellationToken);

        if (items.Count == 0)
        {
            return await ReturnUpdatedCartAsync(cartId, "items-cleared", cancellationToken);
        }

        dbContext.CartItems.RemoveRange(items);
        access.Cart!.UpdatedAt = DateTime.UtcNow;
        access.Participant!.LastSeenAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync(cancellationToken);

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

    [HttpPost("{cartId:guid}/checkout")]
    public async Task<IActionResult> Checkout(
        Guid cartId,
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

        if (cart.Status == CartStatus.Submitted && cart.OrderId.HasValue)
        {
            var existingOrder = await LoadOrderAsync(cart.OrderId.Value, cancellationToken);

            if (existingOrder is null)
            {
                return Conflict(new { message = "Cart was submitted but the order could not be found." });
            }

            await transaction.CommitAsync(cancellationToken);

            return Ok(new CheckoutCartResponse
            {
                Message = "Order was already submitted.",
                Order = MapOrder(existingOrder)
            });
        }

        if (cart.Status != CartStatus.Active)
        {
            return Conflict(new { message = "Cart is no longer active." });
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
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = cart.RestaurantId,
            TableId = cart.TableId,
            CustomerId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? access.Participant?.CustomerId,
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
            if (!menuItems.TryGetValue(cartItem.MenuItemId, out var menuItem) ||
                menuItem.RestaurantId != cart.RestaurantId ||
                menuItem.Category is null ||
                menuItem.Category.RestaurantId != cart.RestaurantId ||
                !menuItem.Category.IsActive ||
                !menuItem.IsAvailable ||
                menuItem.IsSoldOut)
            {
                return Conflict(new
                {
                    message = "Cart contains unavailable, sold out, or cross-restaurant items."
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
                    Quantity = selectedOption.Quantity,
                    CreatedAt = now
                });
            }

            order.OrderItems.Add(orderItem);
        }

        order.TotalAmount = PricingCalculator.CalculateTotal(order.OrderItems.Select(item => (item.Quantity, item.UnitPrice)));
        cart.Status = CartStatus.Submitted;
        cart.OrderId = order.Id;
        cart.UpdatedAt = now;
        access.Participant!.LastSeenAt = now;

        await dbContext.Orders.AddAsync(order, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

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
            Order = orderResponse
        });
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

        if (order.PaymentStatus == PaymentStatus.Paid)
        {
            return Conflict(new { message = "The payment method cannot be changed after payment." });
        }

        if (order.Payments.Any(payment => payment.Status == PaymentStatus.Pending))
        {
            return Conflict(new { message = "The payment method cannot be changed while an online payment is pending." });
        }

        if (paymentMethod == PaymentMethod.PayAtCounter &&
            order.Restaurant?.PaymentPolicy != RestaurantPaymentPolicy.PayAtCounterAllowed)
        {
            return Conflict(new { message = "This restaurant requires online payment before the order can be processed." });
        }

        order.PaymentMethod = paymentMethod;
        order.PaymentStatus = PaymentStatus.Unpaid;
        order.UpdatedAt = DateTime.UtcNow;
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

        if (access.Failure == CartAccessFailure.None && access.Participant is not null)
        {
            var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

            if (!string.IsNullOrWhiteSpace(currentUserId) &&
                !string.Equals(access.Participant.CustomerId, currentUserId, StringComparison.Ordinal))
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
                .Where(selection => selection.Option.GroupId == group.Id)
                .Sum(selection => selection.Quantity);

            if (group.IsRequired && selectedInGroup < group.MinSelections)
            {
                errors.Add($"'{group.Name}' requires at least {group.MinSelections} selection(s) for '{menuItem.Name}'.");
            }

            if (selectedInGroup > group.MaxSelections)
            {
                errors.Add($"'{group.Name}' allows at most {group.MaxSelections} selection(s) for '{menuItem.Name}'.");
            }
        }

        var unitPrice = PricingCalculator.CalculateUnitPrice(
            menuItem.Price,
            selectedOptions.Select(selection => new MenuOptionPriceSelection(selection.Option, selection.Quantity)));

        return new CartOptionSelectionResult(unitPrice, selectedOptions, errors);
    }

    [HttpPost("{cartId:guid}/payment-session")]
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

        return order.RestaurantId.HasValue
            ? $"/r/{Uri.EscapeDataString(order.RestaurantId.Value.ToString())}/menu"
            : "/";
    }

    private static string AddReturnTo(string url, string returnPath)
    {
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(returnPath))
        {
            return url;
        }

        return QueryHelpers.AddQueryString(url, "returnTo", returnPath);
    }

    private static string AppendSessionId(string url)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return "http://localhost:5173/payment/success?session_id={CHECKOUT_SESSION_ID}";
        }

        if (url.Contains("{CHECKOUT_SESSION_ID}", StringComparison.Ordinal))
        {
            return url;
        }

        var separator = url.Contains('?') ? '&' : '?';
        return $"{url}{separator}session_id={{CHECKOUT_SESSION_ID}}";
    }

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
