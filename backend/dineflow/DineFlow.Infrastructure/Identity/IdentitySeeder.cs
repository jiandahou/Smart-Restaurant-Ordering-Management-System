using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Infrastructure.Identity;

public static class IdentitySeeder
{
    private static readonly Guid RestaurantOneId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid RestaurantTwoId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid RestaurantThreeId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly IReadOnlyDictionary<string, string> SeedMenuImageUrls =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Veg Spring Rolls"] = "/seed-menu/veg-spring-rolls.svg",
            ["Chicken Wings"] = "/seed-menu/chicken-wings.svg",
            ["Garlic Bread"] = "/seed-menu/garlic-bread.svg",
            ["Butter Chicken"] = "/seed-menu/butter-chicken.svg",
            ["Veg Fried Rice"] = "/seed-menu/veg-fried-rice.svg",
            ["Grilled Salmon"] = "/seed-menu/grilled-salmon.svg",
            ["Mushroom Pasta"] = "/seed-menu/mushroom-pasta.svg",
            ["Mango Lassi"] = "/seed-menu/mango-lassi.svg",
            ["Masala Chai"] = "/seed-menu/masala-chai.svg",
            ["Fresh Lime Soda"] = "/seed-menu/fresh-lime-soda.svg",
            ["Gulab Jamun"] = "/seed-menu/gulab-jamun.svg",
            ["Chocolate Lava Cake"] = "/seed-menu/chocolate-lava-cake.svg"
        };

    public static async Task SeedAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // ── Roles ────────────────────────────────────────────────────────────
        foreach (var role in ApplicationRoles.All)
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole(role));
        }

        // ── Restaurants (seeded before users because of FK on AspNetUsers) ───
        if (!await dbContext.Restaurants.AnyAsync())
        {
            var restaurantOne = new RestaurantEntity
            {
                Id = RestaurantOneId,
                Name = "The DineFlow Kitchen",
                Address = "42 Flavor Street, Kathmandu 44600",
                Phone = "+977-1-4567890",
                Timezone = "Asia/Kathmandu",
                Currency = "NPR",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            var restaurantTwo = new RestaurantEntity
            {
                Id = RestaurantTwoId,
                Name = "Spice Garden",
                Address = "88 MG Road, Bengaluru, Karnataka 560001",
                Phone = "+91-80-23456789",
                Timezone = "Asia/Kolkata",
                Currency = "INR",
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            var restaurantThree = new RestaurantEntity
            {
                Id = RestaurantThreeId,
                Name = "Harbour Test Kitchen",
                Address = "12 Jetty Lane, Adelaide SA 5000",
                Phone = "+61-8-8123-4567",
                Timezone = "Australia/Adelaide",
                Currency = "AUD",
                IsActive = false,
                CreatedAt = DateTime.UtcNow
            };

            await dbContext.Restaurants.AddRangeAsync(restaurantOne, restaurantTwo, restaurantThree);
            await dbContext.SaveChangesAsync();

            // ── Tables (Restaurant One) ──────────────────────────────────────
            var tables = new List<RestaurantTable>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 2, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T2", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T3", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T4", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 6, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T5", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 8, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "P1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 2, IsActive = false },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "P2", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 10, IsActive = true },
            };

            var restaurantTwoTables = new List<RestaurantTable>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableNumber = "A1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 2, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableNumber = "A2", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableNumber = "B1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 6, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableNumber = "Patio-1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableNumber = "VIP-1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 8, IsActive = false },
            };

            var restaurantThreeTables = new List<RestaurantTable>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantThreeId, TableNumber = "HX1", QrToken = RestaurantTableTokenGenerator.Generate(), Capacity = 4, IsActive = false }
            };

            await dbContext.RestaurantTables.AddRangeAsync(tables);
            await dbContext.RestaurantTables.AddRangeAsync(restaurantTwoTables);
            await dbContext.RestaurantTables.AddRangeAsync(restaurantThreeTables);

            // ── Menu categories & items (Restaurant One) ─────────────────────
            var starters = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Starters",    Description = "Light bites to kick things off",       DisplayOrder = 1, IsActive = true };
            var mains    = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Main Course", Description = "Hearty dishes for every appetite",      DisplayOrder = 2, IsActive = true };
            var drinks   = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Drinks",      Description = "Hot, cold, and everything in between",  DisplayOrder = 3, IsActive = true };
            var desserts = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Desserts",    Description = "Sweet endings",                         DisplayOrder = 4, IsActive = true };

            var restaurantTwoStreetFood = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, Name = "Street Food", Description = "Share plates and snackable favorites", DisplayOrder = 1, IsActive = true };
            var restaurantTwoGrills = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, Name = "Grills", Description = "Tandoor and flame-finished mains", DisplayOrder = 2, IsActive = true };
            var restaurantTwoBeverages = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, Name = "Beverages", Description = "Coolers, chai, and house drinks", DisplayOrder = 3, IsActive = true };
            var restaurantTwoSecretMenu = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, Name = "Late Night Specials", Description = "Used for testing inactive categories", DisplayOrder = 4, IsActive = false };

            await dbContext.MenuCategories.AddRangeAsync(
                starters,
                mains,
                drinks,
                desserts,
                restaurantTwoStreetFood,
                restaurantTwoGrills,
                restaurantTwoBeverages,
                restaurantTwoSecretMenu);
            await dbContext.SaveChangesAsync();

            var menuItems = new List<MenuItem>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Veg Spring Rolls",    Description = "Crispy rolls stuffed with seasoned veggies",              Price = 250, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Spring Rolls") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Chicken Wings",       Description = "Spicy buffalo wings with dipping sauce",                  Price = 450, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Chicken Wings") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Garlic Bread",        Description = "Toasted bread with garlic butter",                        Price = 180, DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Garlic Bread") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Butter Chicken",      Description = "Tender chicken in creamy tomato sauce, served with naan", Price = 650, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Veg Fried Rice",      Description = "Wok-tossed rice with mixed vegetables",                   Price = 380, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Fried Rice") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Grilled Salmon",      Description = "Pan-seared salmon with lemon butter sauce",               Price = 950, DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Grilled Salmon") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Mushroom Pasta",      Description = "Creamy fettuccine with sautéed mushrooms",               Price = 480, DisplayOrder = 4, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mushroom Pasta") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Mango Lassi",         Description = "Chilled yogurt drink blended with fresh mango",           Price = 200, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mango Lassi") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Masala Chai",         Description = "Spiced milk tea brewed the traditional way",              Price = 120, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Masala Chai") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Fresh Lime Soda",     Description = "Sparkling water with fresh lime and a pinch of salt",     Price = 150, DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Fresh Lime Soda") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Gulab Jamun",         Description = "Soft milk-solid dumplings soaked in rose syrup",          Price = 180, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Gulab Jamun") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Chocolate Lava Cake", Description = "Warm cake with a molten chocolate centre",                Price = 320, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Chocolate Lava Cake") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Chef's Tasting Curry", Description = "Seasonal curry used for sold-out state testing",           Price = 720, DisplayOrder = 5, IsAvailable = true, IsSoldOut = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "House Kombucha",      Description = "Temporarily hidden drink for availability testing",       Price = 230, DisplayOrder = 4, IsAvailable = false, ImageUrl = GetSeedMenuImageUrl("Fresh Lime Soda") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoStreetFood.Id, Name = "Paneer Tikka Skewers", Description = "Charred paneer skewers with mint chutney",            Price = 340, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Chicken Wings") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoStreetFood.Id, Name = "Corn Cheese Balls",    Description = "Golden-fried corn and mozzarella croquettes",       Price = 260, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Spring Rolls") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoStreetFood.Id, Name = "Chilli Chicken Bites", Description = "Wok-tossed chicken bites with peppers",               Price = 390, DisplayOrder = 3, IsAvailable = true, IsSoldOut = true, ImageUrl = GetSeedMenuImageUrl("Chicken Wings") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoGrills.Id,     Name = "Tandoori Chicken",    Description = "Half chicken marinated overnight and flame roasted", Price = 590, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoGrills.Id,     Name = "Smoky Paneer Sizzler", Description = "Paneer, onions, and peppers on a hot plate",        Price = 520, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mushroom Pasta") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoGrills.Id,     Name = "Pepper Fish Fry",     Description = "Crisp white fish with black pepper crust",            Price = 610, DisplayOrder = 3, IsAvailable = false, ImageUrl = GetSeedMenuImageUrl("Grilled Salmon") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoBeverages.Id,  Name = "Rose Falooda",        Description = "Chilled rose milk with basil seeds and vermicelli",  Price = 240, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mango Lassi") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoBeverages.Id,  Name = "Masala Cola",         Description = "House cola with chat masala and lime",               Price = 160, DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Fresh Lime Soda") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, CategoryId = restaurantTwoSecretMenu.Id, Name = "After Hours Noodles",  Description = "Inactive item under inactive category for API tests", Price = 430, DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Fried Rice") },
            };

            await dbContext.MenuItems.AddRangeAsync(menuItems);
            await dbContext.SaveChangesAsync();

            // ── Orders ───────────────────────────────────────────────────────
            var completedOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = tables[0].Id,
                OrderNumber = "ORD-0001", OrderType = OrderType.DineIn, Status = OrderStatus.Completed,
                TotalAmount = 1050, CustomerNote = "No onions please", CreatedAt = DateTime.UtcNow.AddHours(-3)
            };
            completedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Butter Chicken").Id, Quantity = 1, UnitPrice = 650, CreatedAt = completedOrder.CreatedAt });
            completedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = completedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Mango Lassi").Id,    Quantity = 2, UnitPrice = 200, CreatedAt = completedOrder.CreatedAt });

            var preparingOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = tables[1].Id,
                OrderNumber = "ORD-0002", OrderType = OrderType.DineIn, Status = OrderStatus.Preparing,
                TotalAmount = 1100, CreatedAt = DateTime.UtcNow.AddMinutes(-20)
            };
            preparingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = preparingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Grilled Salmon").Id,  Quantity = 1, UnitPrice = 950, CreatedAt = preparingOrder.CreatedAt });
            preparingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = preparingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Fresh Lime Soda").Id, Quantity = 1, UnitPrice = 150, ItemInstructions = "Extra ice", CreatedAt = preparingOrder.CreatedAt });

            var pendingOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = tables[2].Id,
                OrderNumber = "ORD-0003", OrderType = OrderType.DineIn, Status = OrderStatus.Pending,
                TotalAmount = 930, CustomerNote = "Allergic to peanuts", CreatedAt = DateTime.UtcNow.AddMinutes(-5)
            };
            pendingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Chicken Wings").Id,  Quantity = 1, UnitPrice = 450, CreatedAt = pendingOrder.CreatedAt });
            pendingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = pendingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Mushroom Pasta").Id, Quantity = 1, UnitPrice = 480, CreatedAt = pendingOrder.CreatedAt });

            var takeawayOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = null,
                OrderNumber = "ORD-0004", OrderType = OrderType.Takeaway, Status = OrderStatus.Ready,
                TotalAmount = 680, CreatedAt = DateTime.UtcNow.AddMinutes(-10)
            };
            takeawayOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = takeawayOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Veg Fried Rice").Id, Quantity = 1, UnitPrice = 380, CreatedAt = takeawayOrder.CreatedAt });
            takeawayOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = takeawayOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Garlic Bread").Id,   Quantity = 1, UnitPrice = 180, CreatedAt = takeawayOrder.CreatedAt });
            takeawayOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = takeawayOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Masala Chai").Id,    Quantity = 1, UnitPrice = 120, CreatedAt = takeawayOrder.CreatedAt });

            var acceptedOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = tables[3].Id,
                OrderNumber = "ORD-0005", OrderType = OrderType.DineIn, Status = OrderStatus.Accepted,
                PaymentStatus = DineFlow.Infrastructure.Payments.PaymentStatus.Paid,
                TotalAmount = 820, CreatedAt = DateTime.UtcNow.AddMinutes(-35)
            };
            acceptedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = acceptedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Veg Fried Rice").Id, Quantity = 1, UnitPrice = 380, CreatedAt = acceptedOrder.CreatedAt });
            acceptedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = acceptedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Chocolate Lava Cake").Id, Quantity = 1, UnitPrice = 320, CreatedAt = acceptedOrder.CreatedAt });
            acceptedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = acceptedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Masala Chai").Id, Quantity = 1, UnitPrice = 120, CreatedAt = acceptedOrder.CreatedAt });

            var cancelledOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableId = tables[4].Id,
                OrderNumber = "ORD-0006", OrderType = OrderType.DineIn, Status = OrderStatus.Cancelled,
                PaymentStatus = DineFlow.Infrastructure.Payments.PaymentStatus.Cancelled,
                TotalAmount = 450, CustomerNote = "Duplicate order placed by mistake", CreatedAt = DateTime.UtcNow.AddHours(-1)
            };
            cancelledOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = cancelledOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Chicken Wings").Id, Quantity = 1, UnitPrice = 450, CreatedAt = cancelledOrder.CreatedAt });

            var restaurantTwoPendingOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableId = restaurantTwoTables[0].Id,
                OrderNumber = "SG-1001", OrderType = OrderType.DineIn, Status = OrderStatus.Pending,
                TotalAmount = 860, CustomerNote = "Shared for table-cart testing", CreatedAt = DateTime.UtcNow.AddMinutes(-8)
            };
            restaurantTwoPendingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoPendingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Paneer Tikka Skewers").Id, Quantity = 1, UnitPrice = 340, CreatedAt = restaurantTwoPendingOrder.CreatedAt });
            restaurantTwoPendingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoPendingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Smoky Paneer Sizzler").Id, Quantity = 1, UnitPrice = 520, Note = "Mild spice", CreatedAt = restaurantTwoPendingOrder.CreatedAt });

            var restaurantTwoReadyTakeaway = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableId = null,
                OrderNumber = "SG-1002", OrderType = OrderType.Takeaway, Status = OrderStatus.Ready,
                PaymentStatus = DineFlow.Infrastructure.Payments.PaymentStatus.Paid,
                TotalAmount = 420, CreatedAt = DateTime.UtcNow.AddMinutes(-18)
            };
            restaurantTwoReadyTakeaway.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoReadyTakeaway.Id, MenuItemId = menuItems.First(m => m.Name == "Corn Cheese Balls").Id, Quantity = 1, UnitPrice = 260, CreatedAt = restaurantTwoReadyTakeaway.CreatedAt });
            restaurantTwoReadyTakeaway.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoReadyTakeaway.Id, MenuItemId = menuItems.First(m => m.Name == "Masala Cola").Id, Quantity = 1, UnitPrice = 160, CreatedAt = restaurantTwoReadyTakeaway.CreatedAt });

            var restaurantTwoRejectedOrder = new Order
            {
                Id = Guid.NewGuid(), RestaurantId = RestaurantTwoId, TableId = restaurantTwoTables[2].Id,
                OrderNumber = "SG-1003", OrderType = OrderType.DineIn, Status = OrderStatus.Rejected,
                PaymentStatus = DineFlow.Infrastructure.Payments.PaymentStatus.Failed,
                TotalAmount = 610, CustomerNote = "Menu item went unavailable during service", CreatedAt = DateTime.UtcNow.AddMinutes(-55)
            };
            restaurantTwoRejectedOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoRejectedOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Pepper Fish Fry").Id, Quantity = 1, UnitPrice = 610, CreatedAt = restaurantTwoRejectedOrder.CreatedAt });

            await dbContext.Orders.AddRangeAsync(
                completedOrder,
                preparingOrder,
                pendingOrder,
                takeawayOrder,
                acceptedOrder,
                cancelledOrder,
                restaurantTwoPendingOrder,
                restaurantTwoReadyTakeaway,
                restaurantTwoRejectedOrder);
            await dbContext.SaveChangesAsync();
        }

        await BackfillSeedMenuImagesAsync(dbContext);
        await BackfillSeedOrderItemNameSnapshotsAsync(dbContext);

        // ── Platform owner ───────────────────────────────────────────────────
        var ownerEmail    = configuration["SeedOwner:Email"];
        var ownerPassword = configuration["SeedOwner:Password"];
        var ownerFullName = configuration["SeedOwner:FullName"] ?? "DineFlow Owner";
        const string ownerAvatarUrl = "/seed-avatars/platform-owner.svg";

        if (!string.IsNullOrWhiteSpace(ownerEmail) && !string.IsNullOrWhiteSpace(ownerPassword))
        {
            var owner = await userManager.FindByEmailAsync(ownerEmail);

            if (owner is null)
            {
                owner = new ApplicationUser
                {
                    UserName = ownerEmail,
                    Email = ownerEmail,
                    FullName = ownerFullName,
                    AvatarUrl = ownerAvatarUrl,
                    RestaurantId = null,
                    EmailConfirmed = true,
                    CreatedAt = DateTime.UtcNow
                };

                var result = await userManager.CreateAsync(owner, ownerPassword);

                if (!result.Succeeded)
                {
                    var errors = string.Join(", ", result.Errors.Select(e => e.Description));
                    throw new Exception($"Failed to seed owner user: {errors}");
                }

                await EnsureRoleAsync(userManager, owner, ApplicationRoles.PlatformOwner);
            }
            else
            {
                owner.FullName = ownerFullName;
                owner.AvatarUrl = string.IsNullOrWhiteSpace(owner.AvatarUrl) ? ownerAvatarUrl : owner.AvatarUrl;
                owner.RestaurantId = null;
                owner.EmailConfirmed = true;
                owner.UpdatedAt = DateTime.UtcNow;

                var updateResult = await userManager.UpdateAsync(owner);

                if (!updateResult.Succeeded)
                {
                    var errors = string.Join(", ", updateResult.Errors.Select(e => e.Description));
                    throw new Exception($"Failed to update owner user: {errors}");
                }

                await SetPasswordAsync(userManager, owner, ownerPassword);
                await EnsureRoleAsync(userManager, owner, ApplicationRoles.PlatformOwner);
            }
        }

        // ── Seed users ───────────────────────────────────────────────────────
        var seedPassword = configuration["SeedUsers:Password"] ?? "DineFlow123!";
        var seedUsers = new[]
        {
            new SeedUser("owner.one@dineflow.test",    "Restaurant One Owner",   ApplicationRoles.RestaurantOwner, RestaurantOneId),
            new SeedUser("owner.two@dineflow.test",    "Restaurant Two Owner",   ApplicationRoles.RestaurantOwner, RestaurantTwoId),

            new SeedUser("admin.one.a@dineflow.test",  "Restaurant One Admin A", ApplicationRoles.Admin, RestaurantOneId),
            new SeedUser("admin.one.b@dineflow.test",  "Restaurant One Admin B", ApplicationRoles.Admin, RestaurantOneId),
            new SeedUser("admin.two.a@dineflow.test",  "Restaurant Two Admin A", ApplicationRoles.Admin, RestaurantTwoId),
            new SeedUser("admin.two.b@dineflow.test",  "Restaurant Two Admin B", ApplicationRoles.Admin, RestaurantTwoId),

            new SeedUser("staff.one.a@dineflow.test",  "Restaurant One Staff A", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.b@dineflow.test",  "Restaurant One Staff B", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.c@dineflow.test",  "Restaurant One Staff C", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.d@dineflow.test",  "Restaurant One Staff D", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.two.a@dineflow.test",  "Restaurant Two Staff A", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.b@dineflow.test",  "Restaurant Two Staff B", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.c@dineflow.test",  "Restaurant Two Staff C", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.d@dineflow.test",  "Restaurant Two Staff D", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.e@dineflow.test",  "Restaurant Two Staff E", ApplicationRoles.Staff, RestaurantTwoId),

            new SeedUser("customer.one@dineflow.test",   "Customer One",   ApplicationRoles.Customer, null),
            new SeedUser("customer.two@dineflow.test",   "Customer Two",   ApplicationRoles.Customer, null),
            new SeedUser("customer.three@dineflow.test", "Customer Three", ApplicationRoles.Customer, null),
            new SeedUser("customer.four@dineflow.test",  "Customer Four",  ApplicationRoles.Customer, null),
            new SeedUser("customer.five@dineflow.test",  "Customer Five",  ApplicationRoles.Customer, null),
            new SeedUser("customer.six@dineflow.test",   "Customer Six",   ApplicationRoles.Customer, null),
        };

        foreach (var seedUser in seedUsers)
            await UpsertUserAsync(userManager, seedUser, seedPassword);
    }

    private static async Task UpsertUserAsync(
        UserManager<ApplicationUser> userManager,
        SeedUser seedUser,
        string password)
    {
        var user = await userManager.FindByEmailAsync(seedUser.Email);

        if (user is null)
        {
            user = new ApplicationUser
            {
                UserName = seedUser.Email,
                Email = seedUser.Email,
                FullName = seedUser.FullName,
                AvatarUrl = seedUser.AvatarUrl,
                RestaurantId = seedUser.RestaurantId,
                EmailConfirmed = true,
                CreatedAt = DateTime.UtcNow
            };

            var result = await userManager.CreateAsync(user, password);

            if (!result.Succeeded)
            {
                var errors = string.Join(", ", result.Errors.Select(e => e.Description));
                throw new Exception($"Failed to seed user {seedUser.Email}: {errors}");
            }
        }
        else
        {
            user.FullName = seedUser.FullName;
            user.AvatarUrl = string.IsNullOrWhiteSpace(user.AvatarUrl) ? seedUser.AvatarUrl : user.AvatarUrl;
            user.RestaurantId = seedUser.RestaurantId;
            user.EmailConfirmed = true;
            user.UpdatedAt = DateTime.UtcNow;

            var result = await userManager.UpdateAsync(user);

            if (!result.Succeeded)
            {
                var errors = string.Join(", ", result.Errors.Select(e => e.Description));
                throw new Exception($"Failed to update seeded user {seedUser.Email}: {errors}");
            }
        }

        await EnsureRoleAsync(userManager, user, seedUser.Role);
    }

    private static async Task SetPasswordAsync(
        UserManager<ApplicationUser> userManager,
        ApplicationUser user,
        string password)
    {
        if (await userManager.HasPasswordAsync(user))
        {
            var removeResult = await userManager.RemovePasswordAsync(user);
            if (!removeResult.Succeeded)
            {
                var errors = string.Join(", ", removeResult.Errors.Select(e => e.Description));
                throw new Exception($"Failed to remove password for {user.Email}: {errors}");
            }
        }

        var addResult = await userManager.AddPasswordAsync(user, password);
        if (!addResult.Succeeded)
        {
            var errors = string.Join(", ", addResult.Errors.Select(e => e.Description));
            throw new Exception($"Failed to set password for {user.Email}: {errors}");
        }
    }

    private static async Task EnsureRoleAsync(
        UserManager<ApplicationUser> userManager,
        ApplicationUser user,
        string role)
    {
        if (await userManager.IsInRoleAsync(user, role))
            return;

        var result = await userManager.AddToRoleAsync(user, role);

        if (!result.Succeeded)
        {
            var errors = string.Join(", ", result.Errors.Select(e => e.Description));
            throw new Exception($"Failed to assign role {role} to {user.Email}: {errors}");
        }
    }

    private sealed record SeedUser(
        string Email,
        string FullName,
        string Role,
        Guid? RestaurantId)
    {
        public string AvatarUrl => $"/seed-avatars/avatar-{GetStableAvatarIndex(Email)}.svg";
    }

    private static int GetStableAvatarIndex(string value)
    {
        var sum = value.Aggregate(0, (current, character) => current + character);
        return sum % 4 + 1;
    }

    private static string? GetSeedMenuImageUrl(string itemName)
    {
        return SeedMenuImageUrls.TryGetValue(itemName, out var imageUrl) ? imageUrl : null;
    }

    private static async Task BackfillSeedMenuImagesAsync(AppDbContext dbContext)
    {
        var seedItemNames = SeedMenuImageUrls.Keys.ToArray();
        var existingSeedItems = await dbContext.MenuItems
            .Where(item =>
                item.RestaurantId == RestaurantOneId &&
                seedItemNames.Contains(item.Name) &&
                (item.ImageUrl == null || item.ImageUrl == string.Empty))
            .ToListAsync();

        if (existingSeedItems.Count == 0)
        {
            return;
        }

        foreach (var item in existingSeedItems)
        {
            item.ImageUrl = GetSeedMenuImageUrl(item.Name);
            item.UpdatedAt = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync();
    }

    private static async Task BackfillSeedOrderItemNameSnapshotsAsync(AppDbContext dbContext)
    {
        var orderItems = await dbContext.OrderItems
            .Where(item => item.ItemNameSnapshot == string.Empty && item.MenuItemId.HasValue)
            .ToListAsync();

        if (orderItems.Count == 0)
        {
            return;
        }

        var menuItemIds = orderItems
            .Select(item => item.MenuItemId!.Value)
            .Distinct()
            .ToArray();

        var menuItemNamesById = await dbContext.MenuItems
            .Where(item => menuItemIds.Contains(item.Id))
            .Select(item => new
            {
                item.Id,
                item.Name
            })
            .ToDictionaryAsync(item => item.Id, item => item.Name);

        foreach (var orderItem in orderItems)
        {
            if (!orderItem.MenuItemId.HasValue ||
                !menuItemNamesById.TryGetValue(orderItem.MenuItemId.Value, out var menuItemName) ||
                string.IsNullOrWhiteSpace(menuItemName))
            {
                continue;
            }

            orderItem.ItemNameSnapshot = menuItemName;
            orderItem.UpdatedAt = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync();
    }
}
