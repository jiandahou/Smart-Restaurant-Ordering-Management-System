using Amazon.S3;
using Amazon.S3.Model;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Restaurant;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
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
            ["Chocolate Lava Cake"] = "/seed-menu/chocolate-lava-cake.svg",
            ["Seasonal Dish"] = "/seed-menu/seasonal-dish.svg",
            ["House Drink"] = "/seed-menu/house-drink.svg"
        };
    private static IReadOnlyDictionary<string, string> ResolvedSeedMenuImageUrls = SeedMenuImageUrls;
    private static readonly string[] DemoOrderItemNames =
    [
        "Butter Chicken", "Mango Lassi", "Grilled Salmon", "Veg Fried Rice",
        "Chicken Wings", "Mushroom Pasta", "Paneer Tikka Skewers", "Masala Cola",
        "Garlic Bread", "Chocolate Lava Cake", "Tandoori Chicken", "Fresh Lime Soda"
    ];
    private static readonly decimal[] DemoOrderItemPrices =
    [
        24.50m, 8.50m, 32.00m, 18.00m, 16.50m, 22.00m,
        17.50m, 7.00m, 9.50m, 12.00m, 27.50m, 6.50m
    ];

    /// <summary>
    /// Authorization roles. Safe everywhere: the application cannot authorize anything without
    /// them, and creating a role that already exists is a no-op.
    /// </summary>
    public static async Task SeedRolesAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();
        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();

        foreach (var role in ApplicationRoles.All)
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole(role));
        }
    }

    /// <summary>
    /// Bootstraps the single platform owner from <c>SeedOwner:*</c> so a fresh deployment has
    /// somebody who can sign in. Safe in Production, with one deliberate restriction: an owner
    /// that already exists never has their password rewritten there. Rewriting it on every boot
    /// would silently undo any password the owner had since chosen, and would hand control of a
    /// live account to whoever can read the deployment configuration.
    /// </summary>
    public static async Task SeedPlatformOwnerAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var environment = scope.ServiceProvider.GetService<IHostEnvironment>();
        var logger = scope.ServiceProvider.GetService<ILoggerFactory>()?.CreateLogger(nameof(IdentitySeeder));

        var ownerEmail = configuration["SeedOwner:Email"];
        var ownerPassword = configuration["SeedOwner:Password"];
        var ownerFullName = configuration["SeedOwner:FullName"] ?? "DineFlow Owner";
        const string ownerAvatarUrl = "/seed-avatars/platform-owner.svg";

        if (string.IsNullOrWhiteSpace(ownerEmail) || string.IsNullOrWhiteSpace(ownerPassword))
        {
            return;
        }

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
            return;
        }

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

        if (environment?.IsProduction() == true)
        {
            logger?.LogInformation(
                "Platform owner {Email} already exists; the configured password was not applied because "
                    + "resetting a live account's password on startup is not permitted in Production.",
                ownerEmail);
        }
        else
        {
            await SetPasswordAsync(userManager, owner, ownerPassword);
        }

        await EnsureRoleAsync(userManager, owner, ApplicationRoles.PlatformOwner);
    }

    /// <summary>
    /// Demo restaurants, menus, orders and the fixed <c>*@dineflow.test</c> accounts that share one
    /// well-known password. Development and testing only — it throws in Production rather than
    /// trusting a configuration flag, because the cost of getting this wrong is fixed-credential
    /// accounts and fabricated orders in a live database.
    /// </summary>
    public static async Task SeedDemoDataAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();

        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var environment = scope.ServiceProvider.GetService<IHostEnvironment>();

        if (environment?.IsProduction() == true)
        {
            throw new InvalidOperationException(
                "Demo data seeding is not permitted in Production. It creates fixed accounts with a "
                    + "shared password and fabricated orders.");
        }

        ResolvedSeedMenuImageUrls = await ResolveSeedMenuImageUrlsAsync(scope.ServiceProvider, configuration);

        // ── Restaurants (seeded before users because of FK on AspNetUsers) ───
        if (!await dbContext.Restaurants.AnyAsync())
        {
            var restaurantOne = new RestaurantEntity
            {
                Id = RestaurantOneId,
                Name = "The DineFlow Kitchen",
                // Australian because Stripe does not operate in Nepal: this restaurant used to be
                // in Kathmandu, which made "Connect Stripe" fail with country_unsupported every
                // time — an unfixable dead end on the demo restaurant people reach for first.
                Address = "42 Flavour Street, Adelaide SA 5000",
                Phone = "+61-8-8100-4242",
                ImageUrl = GetSeedMenuImageUrl("Butter Chicken"),
                CountryCode = "AU",
                Timezone = "Australia/Adelaide",
                Currency = "AUD",
                OpeningHoursJson = RestaurantOneAlwaysOpenJson,
                IsActive = true,
                CreatedAt = DateTime.UtcNow
            };

            var restaurantTwo = new RestaurantEntity
            {
                Id = RestaurantTwoId,
                Name = "Spice Garden",
                Address = "88 MG Road, Bengaluru, Karnataka 560001",
                Phone = "+91-80-23456789",
                ImageUrl = GetSeedMenuImageUrl("Chicken Wings"),
                CountryCode = "IN",
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
                ImageUrl = GetSeedMenuImageUrl("Grilled Salmon"),
                CountryCode = "AU",
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
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Veg Spring Rolls",    Description = "Crispy rolls stuffed with seasoned veggies",              Price = RestaurantOnePrices["Veg Spring Rolls"], DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Spring Rolls") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Chicken Wings",       Description = "Spicy buffalo wings with dipping sauce",                  Price = RestaurantOnePrices["Chicken Wings"], DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Chicken Wings") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Garlic Bread",        Description = "Toasted bread with garlic butter",                        Price = RestaurantOnePrices["Garlic Bread"], DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Garlic Bread") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Butter Chicken",      Description = "Tender chicken in creamy tomato sauce, served with naan", Price = RestaurantOnePrices["Butter Chicken"], DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Veg Fried Rice",      Description = "Wok-tossed rice with mixed vegetables",                   Price = RestaurantOnePrices["Veg Fried Rice"], DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Fried Rice") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Grilled Salmon",      Description = "Pan-seared salmon with lemon butter sauce",               Price = RestaurantOnePrices["Grilled Salmon"], DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Grilled Salmon") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Mushroom Pasta",      Description = "Creamy fettuccine with sautéed mushrooms",               Price = RestaurantOnePrices["Mushroom Pasta"], DisplayOrder = 4, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mushroom Pasta") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Mango Lassi",         Description = "Chilled yogurt drink blended with fresh mango",           Price = RestaurantOnePrices["Mango Lassi"], DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Mango Lassi") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Masala Chai",         Description = "Spiced milk tea brewed the traditional way",              Price = RestaurantOnePrices["Masala Chai"], DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Masala Chai") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Fresh Lime Soda",     Description = "Sparkling water with fresh lime and a pinch of salt",     Price = RestaurantOnePrices["Fresh Lime Soda"], DisplayOrder = 3, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Fresh Lime Soda") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Gulab Jamun",         Description = "Soft milk-solid dumplings soaked in rose syrup",          Price = RestaurantOnePrices["Gulab Jamun"], DisplayOrder = 1, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Gulab Jamun") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Chocolate Lava Cake", Description = "Warm cake with a molten chocolate centre",                Price = RestaurantOnePrices["Chocolate Lava Cake"], DisplayOrder = 2, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Chocolate Lava Cake") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Chef's Tasting Curry", Description = "In stock but manually marked sold out: the flag must win over the count", Price = RestaurantOnePrices["Chef's Tasting Curry"], DisplayOrder = 5, IsAvailable = true, IsSoldOut = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "House Kombucha",      Description = "Temporarily hidden drink for availability testing",       Price = RestaurantOnePrices["House Kombucha"], DisplayOrder = 4, IsAvailable = false, ImageUrl = GetSeedMenuImageUrl("Fresh Lime Soda") },
                // Stock states worth exercising by hand. Reserving happens at checkout, before any
                // payment, so each of these behaves differently when an order is placed, abandoned,
                // or raced against a second customer.
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Kitchen Staple Dal",  Description = "Plenty in stock: the control for anything stock-tracked", Price = RestaurantOnePrices["Kitchen Staple Dal"], DisplayOrder = 6, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Veg Fried Rice") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Tandoori Platter",    Description = "One portion left: for last-one and two-customers-at-once tests", Price = RestaurantOnePrices["Tandoori Platter"], DisplayOrder = 7, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Butter Chicken") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Daily Soup",          Description = "Two portions: ordering both should flip it to sold out",  Price = RestaurantOnePrices["Daily Soup"], DisplayOrder = 4, IsAvailable = true, ImageUrl = GetSeedMenuImageUrl("Garlic Bread") },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Seasonal Sorbet",     Description = "Zero stock: should refuse to be added to a cart",         Price = RestaurantOnePrices["Seasonal Sorbet"], DisplayOrder = 3, IsAvailable = true, IsSoldOut = true, ImageUrl = GetSeedMenuImageUrl("Gulab Jamun") },
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
            restaurantTwoPendingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = restaurantTwoPendingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Smoky Paneer Sizzler").Id, Quantity = 1, UnitPrice = 520, ItemInstructions = "Mild spice", CreatedAt = restaurantTwoPendingOrder.CreatedAt });

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
        // Before the stock baseline: that keys off the menu, and this rewrites its prices.
        await MigrateRestaurantOneToAustraliaAsync(dbContext);
        await OpenRestaurantOneAllDayAsync(dbContext);
        await SeedStockTestingBaselineAsync(dbContext);

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

        await SeedPaginationDemoDataAsync(dbContext);
        await SeedMenuOptionsAsync(dbContext);

        // Runs last: the option table is seeded in rupees and matched by dish name, so it only knows
        // which figures need converting once every restaurant's menu and currency are in place.
        await ConvertSeededOptionPricesToLocalCurrencyAsync(dbContext);

        // After the options exist, since it declares what some of them contain.
        await SeedRestaurantOneAllergensAsync(dbContext);
    }

    private static async Task SeedPaginationDemoDataAsync(AppDbContext dbContext)
    {
        var restaurantSeeds = new[]
        {
            // Six restaurants carry a full trading identity; the ABNs below are synthetic values
            // that satisfy the ABN checksum so the validation path is exercised with realistic
            // data. They are not registered to anyone — an ABR lookup is a manual release step.
            new SeedRestaurant(Guid.Parse("44444444-4444-4444-4444-444444444444"), "Harbour & Hearth", "18 Marina Walk, Adelaide SA", "+61 8 7000 0401", true, "Grilled Salmon",
                LegalBusinessName: "Harbour & Hearth Dining Pty Ltd", Abn: "12844639108", GstRegistered: true,
                BusinessContactEmail: "accounts@harbourandhearth.example", RefundContactEmail: "refunds@harbourandhearth.example",
                CustomerSurchargeNotice: "A 10% surcharge applies on public holidays."),
            new SeedRestaurant(Guid.Parse("55555555-5555-5555-5555-555555555555"), "Laneway Noodles", "42 Peel Street, Adelaide SA", "+61 8 7000 0502", true, "Veg Fried Rice",
                LegalBusinessName: "Laneway Noodle Bar Pty Ltd", Abn: "93101031715", GstRegistered: true,
                BusinessContactEmail: "hello@lanewaynoodles.example", RefundContactEmail: "hello@lanewaynoodles.example"),
            new SeedRestaurant(Guid.Parse("66666666-6666-6666-6666-666666666666"), "North Terrace Cafe", "126 North Terrace, Adelaide SA", "+61 8 7000 0603", true, "Mango Lassi",
                LegalBusinessName: "North Terrace Coffee Co Pty Ltd", Abn: "30313706825", GstRegistered: true,
                BusinessContactEmail: "office@northterracecafe.example", RefundContactEmail: "refunds@northterracecafe.example"),
            new SeedRestaurant(Guid.Parse("77777777-7777-7777-7777-777777777777"), "Parkside Pizza Room", "77 Unley Road, Parkside SA", "+61 8 7000 0704", true, "Mushroom Pasta",
                LegalBusinessName: "Parkside Pizza Room Pty Ltd", Abn: "94336352628", GstRegistered: true,
                BusinessContactEmail: "admin@parksidepizza.example", RefundContactEmail: "refunds@parksidepizza.example",
                CustomerSurchargeNotice: "A 1.5% surcharge applies to card payments."),
            // Sole trader below the GST threshold: registered identity, but not GST registered, so
            // its receipts must print as RECEIPT rather than TAX INVOICE.
            new SeedRestaurant(Guid.Parse("88888888-8888-8888-8888-888888888888"), "Glenelg Sunset Grill", "9 Jetty Road, Glenelg SA", "+61 8 7000 0805", true, "Fresh Lime Soda",
                LegalBusinessName: "A. Whitmore trading as Glenelg Sunset Grill", Abn: "86886693712", GstRegistered: false,
                BusinessContactEmail: "sunsetgrill@example.com", RefundContactEmail: "sunsetgrill@example.com"),
            new SeedRestaurant(Guid.Parse("99999999-9999-9999-9999-999999999999"), "Norwood Garden Kitchen", "151 The Parade, Norwood SA", "+61 8 7000 0906", true, "Garlic Bread",
                LegalBusinessName: "Norwood Garden Kitchen Pty Ltd", Abn: "47325413907", GstRegistered: true,
                BusinessContactEmail: "accounts@norwoodgarden.example", RefundContactEmail: "refunds@norwoodgarden.example"),

            // Deliberately incomplete, so the "identity not provided" paths stay testable:
            // no ABN and no contacts at all.
            new SeedRestaurant(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "Central Market Table", "44 Gouger Street, Adelaide SA", "+61 8 7000 1007", true, "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=1600&q=80"),
            // Inactive and unidentified.
            new SeedRestaurant(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), "West End Test Kitchen", "23 Hindley Street, Adelaide SA", "+61 8 7000 1108", false, "Chocolate Lava Cake"),
            // Half-configured: a legal name and contacts, but the ABN was never supplied.
            new SeedRestaurant(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"), "Hills Seasonal Dining", "6 Mount Barker Road, Stirling SA", "+61 8 7000 1209", true, "Gulab Jamun",
                LegalBusinessName: "Hills Seasonal Dining Pty Ltd", Abn: null, GstRegistered: false,
                BusinessContactEmail: "bookings@hillsseasonal.example", RefundContactEmail: "bookings@hillsseasonal.example")
        };

        var existingRestaurantIds = (await dbContext.Restaurants
            .Where(restaurant => restaurantSeeds.Select(seed => seed.Id).Contains(restaurant.Id))
            .Select(restaurant => restaurant.Id)
            .ToListAsync())
            .ToHashSet();

        var missingRestaurants = restaurantSeeds
            .Where(seed => !existingRestaurantIds.Contains(seed.Id))
            .Select(seed => new RestaurantEntity
            {
                Id = seed.Id,
                Name = seed.Name,
                Address = seed.Address,
                Phone = seed.Phone,
                LegalBusinessName = seed.LegalBusinessName,
                Abn = seed.Abn,
                GstRegistered = seed.GstRegistered,
                PricesIncludeGst = seed.GstRegistered,
                BusinessContactEmail = seed.BusinessContactEmail,
                RefundContactEmail = seed.RefundContactEmail,
                CustomerSurchargeNotice = seed.CustomerSurchargeNotice,
                ImageUrl = GetSeedRestaurantImageUrl(seed.CoverItemName),
                CountryCode = "AU",
                Timezone = "Australia/Adelaide",
                Currency = "AUD",
                IsActive = seed.IsActive,
                CreatedAt = DateTime.UtcNow.AddDays(-120)
            })
            .ToList();

        if (missingRestaurants.Count > 0)
        {
            await dbContext.Restaurants.AddRangeAsync(missingRestaurants);
            await dbContext.SaveChangesAsync();
        }

        var seedImagesByRestaurantId = restaurantSeeds.ToDictionary(
            seed => seed.Id,
            seed => GetSeedRestaurantImageUrl(seed.CoverItemName));
        var seedRestaurants = await dbContext.Restaurants
            .Where(restaurant => seedImagesByRestaurantId.Keys.Contains(restaurant.Id))
            .ToListAsync();

        var updatedRestaurantImages = 0;
        foreach (var restaurant in seedRestaurants)
        {
            var imageUrl = seedImagesByRestaurantId[restaurant.Id];

            if (imageUrl is not null &&
                !string.Equals(restaurant.ImageUrl, imageUrl, StringComparison.OrdinalIgnoreCase) &&
                (string.IsNullOrWhiteSpace(restaurant.ImageUrl) || IsSeedRestaurantImageUrl(restaurant.ImageUrl)))
            {
                restaurant.ImageUrl = imageUrl;
                restaurant.UpdatedAt = DateTime.UtcNow;
                updatedRestaurantImages++;
            }
        }

        if (updatedRestaurantImages > 0)
        {
            await dbContext.SaveChangesAsync();
        }

        await SeedDemoMenusAsync(dbContext, restaurantSeeds);

        var coreRestaurantIds = (await dbContext.Restaurants
            .Where(restaurant => restaurant.Id == RestaurantOneId || restaurant.Id == RestaurantTwoId)
            .Select(restaurant => restaurant.Id)
            .ToListAsync())
            .ToHashSet();

        var orderRestaurantIds = new List<Guid>();
        if (coreRestaurantIds.Contains(RestaurantOneId))
        {
            orderRestaurantIds.AddRange(Enumerable.Repeat(RestaurantOneId, 40));
        }

        if (coreRestaurantIds.Contains(RestaurantTwoId))
        {
            orderRestaurantIds.AddRange(Enumerable.Repeat(RestaurantTwoId, 25));
        }

        foreach (var restaurant in restaurantSeeds)
        {
            orderRestaurantIds.AddRange(Enumerable.Repeat(restaurant.Id, 3));
        }

        var existingOrderNumbers = (await dbContext.Orders
            .Where(order => order.OrderNumber.StartsWith("DEMO-"))
            .Select(order => order.OrderNumber)
            .ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var customerIds = await dbContext.Users
            .Where(user => user.Email != null && user.Email.StartsWith("customer."))
            .OrderBy(user => user.Email)
            .Select(user => user.Id)
            .ToListAsync();
        var tablesByRestaurant = await dbContext.RestaurantTables
            .Where(table => table.IsActive && (table.RestaurantId == RestaurantOneId || table.RestaurantId == RestaurantTwoId))
            .OrderBy(table => table.TableNumber)
            .GroupBy(table => table.RestaurantId)
            .ToDictionaryAsync(group => group.Key, group => group.Select(table => table.Id).ToList());

        var orderStatuses = new[]
        {
            OrderStatus.Pending,
            OrderStatus.Accepted,
            OrderStatus.Preparing,
            OrderStatus.Ready,
            OrderStatus.Completed,
            OrderStatus.Cancelled,
            OrderStatus.Rejected
        };
        var paymentStatuses = new[]
        {
            PaymentStatus.Pending,
            PaymentStatus.Paid,
            PaymentStatus.Failed,
            PaymentStatus.Expired,
            PaymentStatus.Refunded,
            PaymentStatus.PartiallyRefunded,
            PaymentStatus.Cancelled,
            PaymentStatus.NotRequired
        };
        var now = DateTime.UtcNow;
        var newOrders = new List<Order>();

        for (var index = 0; index < orderRestaurantIds.Count; index++)
        {
            var sequence = index + 1;
            var orderNumber = $"DEMO-{sequence:0000}";

            if (existingOrderNumbers.Contains(orderNumber))
            {
                continue;
            }

            var restaurantId = orderRestaurantIds[index];
            var orderType = (OrderType)(index % 3);
            var createdAt = now.AddHours(-(index * 7 + index % 5));
            var firstItemIndex = index % DemoOrderItemNames.Length;
            var secondItemIndex = (index * 5 + 3) % DemoOrderItemNames.Length;
            var firstQuantity = index % 3 + 1;
            var secondQuantity = index % 2 + 1;
            var totalAmount = firstQuantity * DemoOrderItemPrices[firstItemIndex] + secondQuantity * DemoOrderItemPrices[secondItemIndex];
            Guid? tableId = null;

            if (orderType == OrderType.DineIn &&
                tablesByRestaurant.TryGetValue(restaurantId, out var tableIds) &&
                tableIds.Count > 0)
            {
                tableId = tableIds[index % tableIds.Count];
            }

            var paymentStatus = paymentStatuses[index % paymentStatuses.Length];
            var order = new Order
            {
                Id = CreateSeedGuid(1, sequence),
                RestaurantId = restaurantId,
                TableId = tableId,
                CustomerId = customerIds.Count == 0 ? null : customerIds[index % customerIds.Count],
                OrderNumber = orderNumber,
                OrderType = orderType,
                Status = orderStatuses[index % orderStatuses.Length],
                PaymentStatus = paymentStatus,
                TotalAmount = totalAmount,
                CustomerNote = index % 6 == 0 ? $"Pagination demo note {sequence}" : null,
                ScheduledTime = orderType == OrderType.Scheduled ? createdAt.AddHours(3) : null,
                CreatedAt = createdAt,
                UpdatedAt = createdAt.AddMinutes(15)
            };

            order.OrderItems.Add(new OrderItem
            {
                Id = CreateSeedGuid(2, sequence * 2 - 1),
                OrderId = order.Id,
                MenuItemNameSnapshot = DemoOrderItemNames[firstItemIndex],
                BasePriceSnapshot = DemoOrderItemPrices[firstItemIndex],
                Quantity = firstQuantity,
                UnitPrice = DemoOrderItemPrices[firstItemIndex],
                ItemInstructions = index % 9 == 0 ? "Seeded special request" : null,
                CreatedAt = createdAt
            });
            order.OrderItems.Add(new OrderItem
            {
                Id = CreateSeedGuid(2, sequence * 2),
                OrderId = order.Id,
                MenuItemNameSnapshot = DemoOrderItemNames[secondItemIndex],
                BasePriceSnapshot = DemoOrderItemPrices[secondItemIndex],
                Quantity = secondQuantity,
                UnitPrice = DemoOrderItemPrices[secondItemIndex],
                CreatedAt = createdAt.AddSeconds(10)
            });

            if (paymentStatus != PaymentStatus.NotRequired)
            {
                var paymentCreatedAt = createdAt.AddMinutes(2);
                order.Payments.Add(new Payment
                {
                    Id = CreateSeedGuid(3, sequence),
                    OrderId = order.Id,
                    Provider = PaymentProviders.Stripe,
                    ProviderCheckoutSessionId = $"cs_demo_{sequence:0000}",
                    ProviderPaymentIntentId = $"pi_demo_{sequence:0000}",
                    AmountCents = Convert.ToInt64(totalAmount * 100),
                    Currency = "aud",
                    Status = paymentStatus,
                    FailureReason = paymentStatus == PaymentStatus.Failed ? "Seeded card decline for filtering tests" : null,
                    CreatedAt = paymentCreatedAt,
                    UpdatedAt = paymentCreatedAt.AddMinutes(5),
                    PaidAt = paymentStatus == PaymentStatus.Paid ? paymentCreatedAt.AddMinutes(2) : null,
                    FailedAt = paymentStatus == PaymentStatus.Failed ? paymentCreatedAt.AddMinutes(2) : null
                });
            }

            newOrders.Add(order);
        }

        if (newOrders.Count > 0)
        {
            await dbContext.Orders.AddRangeAsync(newOrders);
            await dbContext.SaveChangesAsync();
        }

        await SeedDemoRefundsAsync(dbContext);
    }

    private static async Task SeedDemoRefundsAsync(AppDbContext dbContext)
    {
        var seeds = new[]
        {
            new DemoRefundSeed(5, PaymentRefundStatus.Succeeded, 1.00m, "Customer cancelled before kitchen started", null, "full"),
            new DemoRefundSeed(6, PaymentRefundStatus.Succeeded, 0.45m, "Partial refund for a missing item", null, "partial"),
            new DemoRefundSeed(10, PaymentRefundStatus.Pending, 1.00m, "Refund submitted and waiting for Stripe confirmation", null, "pending"),
            new DemoRefundSeed(18, PaymentRefundStatus.Failed, 1.00m, "Refund attempted after customer support review", "Seeded issuer refund failure", "failed"),
            new DemoRefundSeed(22, PaymentRefundStatus.Succeeded, 0.30m, "Service recovery credit", null, "credit")
        };
        var paymentIds = seeds
            .Select(seed => CreateSeedGuid(3, seed.OrderSequence))
            .ToArray();
        var payments = await dbContext.Payments
            .Include(payment => payment.Refunds)
            .Include(payment => payment.Order)
            .Where(payment => paymentIds.Contains(payment.Id))
            .ToDictionaryAsync(payment => payment.Id);
        var changed = false;

        foreach (var seed in seeds)
        {
            var paymentId = CreateSeedGuid(3, seed.OrderSequence);
            if (!payments.TryGetValue(paymentId, out var payment) || payment.Order is null)
            {
                continue;
            }

            var providerRefundId = $"re_demo_{seed.Slug}_{seed.OrderSequence:0000}";
            if (!payment.Refunds.Any(refund => refund.ProviderRefundId == providerRefundId))
            {
                var createdAt = payment.CreatedAt.AddMinutes(20 + seed.OrderSequence % 7);
                var amountCents = Math.Max(1, Convert.ToInt64(Math.Round(payment.AmountCents * seed.AmountRatio, MidpointRounding.AwayFromZero)));
                var refund = new PaymentRefund
                {
                    Id = CreateSeedGuid(8, seed.OrderSequence),
                    PaymentId = payment.Id,
                    OrderId = payment.OrderId,
                    Provider = PaymentProviders.Stripe,
                    ProviderRefundId = providerRefundId,
                    ProviderPaymentIntentId = payment.ProviderPaymentIntentId,
                    AmountCents = amountCents,
                    Currency = payment.Currency,
                    Status = seed.Status,
                    Reason = seed.Reason,
                    FailureReason = seed.FailureReason,
                    RequestedByUserId = null,
                    CreatedAt = createdAt,
                    UpdatedAt = createdAt.AddMinutes(2),
                    RefundedAt = seed.Status == PaymentRefundStatus.Succeeded ? createdAt.AddMinutes(2) : null,
                    FailedAt = seed.Status == PaymentRefundStatus.Failed ? createdAt.AddMinutes(2) : null
                };
                payment.Refunds.Add(refund);
                dbContext.PaymentRefunds.Add(refund);
                changed = true;
            }

            var succeededAmountCents = payment.Refunds
                .Where(refund => refund.Status == PaymentRefundStatus.Succeeded)
                .Sum(refund => refund.AmountCents);
            var expectedStatus = succeededAmountCents >= payment.AmountCents
                ? PaymentStatus.Refunded
                : succeededAmountCents > 0
                    ? PaymentStatus.PartiallyRefunded
                    : PaymentStatus.Paid;

            if (payment.Status != expectedStatus)
            {
                payment.Status = expectedStatus;
                changed = true;
            }

            if (payment.Order.PaymentStatus != expectedStatus)
            {
                payment.Order.PaymentStatus = expectedStatus;
                changed = true;
            }

            payment.PaidAt ??= payment.CreatedAt.AddMinutes(2);
            payment.UpdatedAt = payment.CreatedAt.AddMinutes(25);
            payment.Order.UpdatedAt = payment.CreatedAt.AddMinutes(25);
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    private static async Task SeedDemoMenusAsync(
        AppDbContext dbContext,
        IReadOnlyList<SeedRestaurant> restaurants)
    {
        var categoryNames = new[]
        {
            new[] { "From the Sea", "Fire & Grill", "Desserts & Drinks" },
            new[] { "Small Bowls", "Noodle House", "Sides & Sips" },
            new[] { "Breakfast", "Cafe Lunch", "Bakes & Coffee" },
            new[] { "Antipasti", "Stone-Baked Pizza", "Dolci & Drinks" },
            new[] { "Coastal Starters", "Sunset Grill", "Sweet Finish" },
            new[] { "Garden Plates", "Seasonal Mains", "Pantry Treats" },
            new[] { "Market Snacks", "Fresh Counter", "Drinks & Sweets" },
            new[] { "Test Bites", "Experimental Mains", "Lab Drinks" },
            new[] { "Hills Starters", "Seasonal Dining", "Cellar & Dessert" }
        };
        var dishNames = new[]
        {
            new[] { "Charred Spencer Gulf Prawns", "Coffin Bay Oysters", "Wood-Fired Barramundi", "Peppercorn Steak", "Lemon Myrtle Pavlova", "Harbour Spritz" },
            new[] { "Pork & Chive Dumplings", "Crispy Tofu Bites", "Spicy Beef Noodles", "Miso Mushroom Udon", "Cucumber Sesame Salad", "Lychee Iced Tea" },
            new[] { "Smashed Avocado Toast", "Ricotta Hotcakes", "Chicken Club Sandwich", "Roasted Pumpkin Salad", "Almond Croissant", "Flat White" },
            new[] { "Burrata & Tomato", "Garlic Rosemary Focaccia", "Margherita Pizza", "Prosciutto Funghi Pizza", "Tiramisu", "Blood Orange Soda" },
            new[] { "Salt & Pepper Squid", "Grilled Halloumi", "Herb-Crusted Salmon", "Flame-Grilled Chicken", "Mango Cheesecake", "Sunset Cooler" },
            new[] { "Zucchini Fritters", "Roasted Beet Salad", "Wild Mushroom Risotto", "Garden Herb Gnocchi", "Carrot Cake", "Elderflower Fizz" },
            new[] { "Market Arancini", "Seasonal Bruschetta", "Barossa Beef Burger", "Market Vegetable Bowl", "Chocolate Brownie", "Fresh Lemonade" },
            new[] { "Prototype Croquettes", "Beta Bruschetta", "Version Two Burger", "Feature Flag Curry", "Sandbox Sundae", "Debugging Tonic" },
            new[] { "Adelaide Hills Olives", "Smoked Trout Crostini", "Slow-Cooked Lamb Shoulder", "Chestnut Mushroom Pie", "Apple Crumble", "Hills Pinot Spritz" }
        };
        var imageFallbackNames = new[]
        {
            "Chicken Wings", "Veg Spring Rolls", "Grilled Salmon",
            "Mushroom Pasta", "Chocolate Lava Cake", "Fresh Lime Soda"
        };
        var genericPlaceholderNames = new[] { "Seasonal Dish", "House Drink" };
        var categoryIds = restaurants
            .SelectMany((_, restaurantIndex) => Enumerable.Range(0, 3)
                .Select(categoryIndex => CreateSeedGuid(4, restaurantIndex * 10 + categoryIndex + 1)))
            .ToArray();
        var existingCategories = await dbContext.MenuCategories
            .Where(category => categoryIds.Contains(category.Id))
            .ToListAsync();
        var existingCategoryIds = existingCategories.Select(category => category.Id).ToHashSet();
        var newCategories = new List<MenuCategory>();

        foreach (var category in existingCategories.Where(category =>
                     category.Description != null &&
                     category.Description.StartsWith("Seeded menu section for ", StringComparison.Ordinal)))
        {
            category.Description = "Seasonal favourites prepared fresh by the kitchen.";
        }

        for (var restaurantIndex = 0; restaurantIndex < restaurants.Count; restaurantIndex++)
        {
            for (var categoryIndex = 0; categoryIndex < 3; categoryIndex++)
            {
                var categoryId = CreateSeedGuid(4, restaurantIndex * 10 + categoryIndex + 1);
                if (existingCategoryIds.Contains(categoryId))
                {
                    continue;
                }

                newCategories.Add(new MenuCategory
                {
                    Id = categoryId,
                    RestaurantId = restaurants[restaurantIndex].Id,
                    Name = categoryNames[restaurantIndex][categoryIndex],
                    Description = "Seasonal favourites prepared fresh by the kitchen.",
                    DisplayOrder = categoryIndex + 1,
                    IsActive = !(categoryIndex == 2 && restaurantIndex % 3 == 1),
                    CreatedAt = DateTime.UtcNow.AddDays(-60 + restaurantIndex)
                });
            }
        }

        if (newCategories.Count > 0)
        {
            await dbContext.MenuCategories.AddRangeAsync(newCategories);
            await dbContext.SaveChangesAsync();
        }

        var itemIds = restaurants
            .SelectMany((_, restaurantIndex) => Enumerable.Range(0, 6)
                .Select(itemIndex => CreateSeedGuid(5, restaurantIndex * 100 + itemIndex + 1)))
            .ToArray();
        var existingItems = await dbContext.MenuItems
            .Where(item => itemIds.Contains(item.Id))
            .ToListAsync();
        var existingItemsById = existingItems.ToDictionary(item => item.Id);
        var newItems = new List<MenuItem>();

        for (var restaurantIndex = 0; restaurantIndex < restaurants.Count; restaurantIndex++)
        {
            for (var itemIndex = 0; itemIndex < 6; itemIndex++)
            {
                var itemId = CreateSeedGuid(5, restaurantIndex * 100 + itemIndex + 1);
                var itemProfile = BuildSeedMenuItemProfile(
                    dishNames[restaurantIndex][itemIndex],
                    itemIndex);

                if (existingItemsById.TryGetValue(itemId, out var existingItem))
                {
                    var usesOriginalLegacyProfile =
                        existingItem.Description?.StartsWith("A signature selection from ", StringComparison.Ordinal) == true;
                    var usesSeedProfile =
                        usesOriginalLegacyProfile ||
                        string.Equals(existingItem.Description, itemProfile.Description, StringComparison.Ordinal);

                    if (usesOriginalLegacyProfile)
                    {
                        ApplySeedMenuItemProfile(existingItem, itemProfile);
                    }

                    // Self-healing: an earlier build of this seeder briefly downgraded these items
                    // to a shared generic placeholder. Restore the per-dish photo for any item
                    // still sitting on that placeholder; items already on a bespoke photo (or a
                    // user's own upload) are left untouched.
                    if (usesSeedProfile && genericPlaceholderNames.Any(name =>
                            string.Equals(existingItem.ImageUrl, GetSeedMenuImageUrl(name), StringComparison.OrdinalIgnoreCase)))
                    {
                        existingItem.ImageUrl = GetSeedMenuImageUrl(imageFallbackNames[itemIndex]);
                    }
                    continue;
                }

                var categoryIndex = itemIndex / 2;
                newItems.Add(new MenuItem
                {
                    Id = itemId,
                    RestaurantId = restaurants[restaurantIndex].Id,
                    CategoryId = CreateSeedGuid(4, restaurantIndex * 10 + categoryIndex + 1),
                    Name = dishNames[restaurantIndex][itemIndex],
                    Description = itemProfile.Description,
                    Price = itemProfile.Price,
                    ImageUrl = GetSeedMenuImageUrl(imageFallbackNames[itemIndex]),
                    IsAvailable = !(itemIndex == 4 && restaurantIndex % 2 == 0),
                    IsSoldOut = itemIndex == 2 && restaurantIndex % 3 == 0,
                    IsVegetarian = itemProfile.IsVegetarian,
                    IsVegan = itemProfile.IsVegan,
                    IsGlutenFree = itemProfile.IsGlutenFree,
                    IsHalal = itemProfile.IsHalal,
                    Allergens = itemProfile.Allergens,
                    SpiceLevel = itemProfile.SpiceLevel,
                    ServingSize = itemProfile.ServingSize,
                    Calories = itemProfile.Calories,
                    IsPopular = itemProfile.IsPopular,
                    IsRecommended = itemProfile.IsRecommended,
                    DisplayOrder = itemIndex % 2 + 1,
                    CreatedAt = DateTime.UtcNow.AddDays(-55 + restaurantIndex)
                });
            }
        }

        if (newItems.Count > 0)
        {
            await dbContext.MenuItems.AddRangeAsync(newItems);
        }

        await dbContext.SaveChangesAsync();
    }

    private static SeedMenuItemProfile BuildSeedMenuItemProfile(string name, int itemIndex)
    {
        var normalizedName = name.ToLowerInvariant();
        var isDrink = itemIndex == 5;
        var isDessert = itemIndex == 4;
        var isVegetarian = new[]
        {
            "tofu", "cucumber", "avocado", "ricotta", "pumpkin", "croissant", "burrata",
            "focaccia", "margherita", "tiramisu", "halloumi", "cheesecake", "zucchini",
            "beet", "mushroom", "gnocchi", "carrot", "arancini", "bruschetta", "vegetable",
            "brownie", "croquette", "sundae", "olives", "crumble"
        }.Any(normalizedName.Contains) || isDrink;
        var isVegan = new[]
        {
            "cucumber", "pumpkin salad", "beet salad", "vegetable bowl", "olives",
            "iced tea", "soda", "spritz", "cooler", "fizz", "lemonade", "tonic"
        }.Any(normalizedName.Contains);
        var allergens = normalizedName switch
        {
            var value when value.Contains("oyster") || value.Contains("prawn") || value.Contains("squid") =>
                "Shellfish",
            var value when value.Contains("tofu") || value.Contains("miso") || value.Contains("sesame") =>
                "Soy, sesame",
            var value when value.Contains("pizza") || value.Contains("focaccia") || value.Contains("croissant") =>
                "Gluten, milk",
            var value when value.Contains("tiramisu") || value.Contains("cheesecake") || value.Contains("brownie") =>
                "Milk, egg, gluten",
            _ => null
        };

        return new SeedMenuItemProfile(
            Description: isDrink
                ? "A refreshing house-made drink served chilled."
                : isDessert
                    ? "A house dessert made for a sweet finish."
                    : "Prepared to order with seasonal produce and the kitchen's signature finish.",
            Price: itemIndex switch
            {
                0 => 16.00m,
                1 => 14.50m,
                2 => 27.50m,
                3 => 21.00m,
                4 => 12.00m,
                _ => 7.50m
            },
            IsVegetarian: isVegetarian,
            IsVegan: isVegan,
            IsGlutenFree: normalizedName.Contains("salad") || normalizedName.Contains("oyster"),
            IsHalal: normalizedName.Contains("chicken") || isVegetarian,
            Allergens: allergens,
            SpiceLevel: normalizedName.Contains("spicy") || normalizedName.Contains("curry") ? 2 :
                normalizedName.Contains("pepper") || normalizedName.Contains("flame") ? 1 : 0,
            ServingSize: isDrink ? "330 ml" : "1 serving",
            Calories: isDrink ? 140 : isDessert ? 480 : 320 + itemIndex * 70,
            IsPopular: itemIndex == 2,
            IsRecommended: itemIndex == 0);
    }

    private static void ApplySeedMenuItemProfile(MenuItem item, SeedMenuItemProfile profile)
    {
        item.Description = profile.Description;
        item.Price = profile.Price;
        item.IsVegetarian = profile.IsVegetarian;
        item.IsVegan = profile.IsVegan;
        item.IsGlutenFree = profile.IsGlutenFree;
        item.IsHalal = profile.IsHalal;
        item.Allergens = profile.Allergens;
        item.SpiceLevel = profile.SpiceLevel;
        item.ServingSize = profile.ServingSize;
        item.Calories = profile.Calories;
        item.IsPopular = profile.IsPopular;
        item.IsRecommended = profile.IsRecommended;
        item.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>
    /// Converts option prices in a database that was seeded before the divisor above existed.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Seeding options only ever inserts the ones that are missing, so correcting the table alone
    /// fixes new databases and leaves every existing one offering a A$150 garlic naan beside a A$24
    /// butter chicken. This rewrites those rows.
    /// </para>
    /// <para>
    /// Keyed on the stored price still being the exact rupee figure it was seeded with: a price
    /// somebody has since edited is left alone, the same way the opening hours and stock baselines
    /// only touch untouched defaults. The target comes from the constants each time, so running it
    /// again after it has done its work changes nothing.
    /// </para>
    /// </remarks>
    internal static async Task ConvertSeededOptionPricesToLocalCurrencyAsync(AppDbContext dbContext)
    {
        var currencyByRestaurant = await dbContext.Restaurants
            .Select(restaurant => new { restaurant.Id, restaurant.Currency })
            .ToDictionaryAsync(entry => entry.Id, entry => entry.Currency);

        // (dish, group, option) -> the rupee figure the table holds. The group belongs in the key:
        // one dish can offer the same option name in two groups at two different prices.
        var seededPrices = BuildSeedMenuOptionGroups()
            .SelectMany(group => group.Options.Select(option =>
                (group.MenuItemName, GroupName: group.Name, option.Name, option.PriceAdjustment)))
            .ToDictionary(
                entry => SeededOptionKey(entry.MenuItemName, entry.GroupName, entry.Name),
                entry => entry.PriceAdjustment);

        var options = await dbContext.MenuItemOptions
            .Join(
                dbContext.MenuItems,
                option => option.MenuItemId,
                menuItem => menuItem.Id,
                (option, menuItem) => new { Option = option, MenuItemName = menuItem.Name })
            .Join(
                dbContext.MenuItemOptionGroups,
                row => row.Option.GroupId,
                group => group.Id,
                (row, group) => new { row.Option, row.MenuItemName, GroupName = group.Name })
            .ToListAsync();

        var corrected = 0;

        foreach (var row in options)
        {
            var divisor = OptionPriceDivisorFor(currencyByRestaurant.GetValueOrDefault(row.Option.RestaurantId));

            if (divisor == 1m
                || !seededPrices.TryGetValue(SeededOptionKey(row.MenuItemName, row.GroupName, row.Option.Name), out var rupees)
                || row.Option.PriceAdjustment != rupees)
            {
                continue;
            }

            row.Option.PriceAdjustment = ConvertOptionPrice(rupees, divisor);
            row.Option.UpdatedAt = DateTime.UtcNow;
            corrected++;
        }

        if (corrected > 0)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    /// <summary>
    /// How much to divide the seeded option prices by for a restaurant trading in this currency.
    /// </summary>
    /// <remarks>
    /// Always applied to the constants rather than to whatever is already stored, so seeding twice
    /// cannot divide a price twice.
    /// </remarks>
    private static decimal OptionPriceDivisorFor(string? currency) =>
        string.Equals(currency, "AUD", StringComparison.OrdinalIgnoreCase) ? RupeeToAudDivisor : 1m;

    /// <summary>
    /// Identifies one seeded option by the dish, group and option it names, ignoring case. The group
    /// is part of it because a dish can offer the same option name in two groups at two prices.
    /// </summary>
    private static string SeededOptionKey(string menuItemName, string groupName, string optionName) =>
        string.Join('|', menuItemName.Trim().ToUpperInvariant(),
            groupName.Trim().ToUpperInvariant(), optionName.Trim().ToUpperInvariant());

    private static decimal ConvertOptionPrice(decimal rupees, decimal divisor) =>
        Math.Round(rupees / divisor, 2, MidpointRounding.AwayFromZero);

    private static async Task SeedMenuOptionsAsync(AppDbContext dbContext)
    {
        var explicitSeeds = BuildSeedMenuOptionGroups();
        var explicitNames = explicitSeeds
            .Select(seed => seed.MenuItemName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var demoItemSequencesById = BuildDemoMenuItemSequences();
        var demoItemIds = demoItemSequencesById.Keys.ToArray();

        var menuItems = await dbContext.MenuItems
            .Where(item => explicitNames.Contains(item.Name) || demoItemIds.Contains(item.Id))
            .Select(item => new
            {
                item.Id,
                item.RestaurantId,
                item.Name
            })
            .ToListAsync();

        if (menuItems.Count == 0)
        {
            return;
        }

        var currencyByRestaurant = await dbContext.Restaurants
            .Select(restaurant => new { restaurant.Id, restaurant.Currency })
            .ToDictionaryAsync(entry => entry.Id, entry => entry.Currency);

        var resolvedSeeds = new List<ResolvedMenuOptionGroupSeed>();

        foreach (var seed in explicitSeeds)
        {
            foreach (var menuItem in menuItems.Where(item =>
                         string.Equals(item.Name, seed.MenuItemName, StringComparison.OrdinalIgnoreCase)))
            {
                var divisor = OptionPriceDivisorFor(
                    currencyByRestaurant.GetValueOrDefault(menuItem.RestaurantId));

                resolvedSeeds.Add(seed.Resolve(menuItem.Id, menuItem.RestaurantId, divisor));
            }
        }

        foreach (var menuItem in menuItems.Where(item => demoItemSequencesById.ContainsKey(item.Id)))
        {
            if (explicitNames.Contains(menuItem.Name, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            var sequence = demoItemSequencesById[menuItem.Id];
            resolvedSeeds.AddRange(BuildGenericSeedMenuOptionGroups(menuItem.Id, menuItem.RestaurantId, sequence));
        }

        if (resolvedSeeds.Count == 0)
        {
            return;
        }

        var seededMenuItemIds = resolvedSeeds
            .Select(seed => seed.MenuItemId)
            .Distinct()
            .ToArray();
        var existingGroups = await dbContext.MenuItemOptionGroups
            .Include(group => group.Options)
            .Where(group => seededMenuItemIds.Contains(group.MenuItemId))
            .ToListAsync();
        var existingGroupsByKey = existingGroups
            .GroupBy(group => MenuOptionGroupKey(group.MenuItemId, group.Name))
            .ToDictionary(group => group.Key, group => group.First());
        var newGroups = new List<MenuItemOptionGroup>();
        var newOptions = new List<MenuItemOption>();

        foreach (var seed in resolvedSeeds)
        {
            var groupKey = MenuOptionGroupKey(seed.MenuItemId, seed.Name);
            if (!existingGroupsByKey.TryGetValue(groupKey, out var group))
            {
                group = new MenuItemOptionGroup
                {
                    Id = CreateSeedGuid(6, seed.Sequence),
                    MenuItemId = seed.MenuItemId,
                    RestaurantId = seed.RestaurantId,
                    Name = seed.Name,
                    IsRequired = seed.IsRequired,
                    MinSelections = seed.MinSelections,
                    MaxSelections = seed.MaxSelections,
                    DisplayOrder = seed.DisplayOrder,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow.AddDays(-45)
                };

                existingGroupsByKey[groupKey] = group;
                newGroups.Add(group);
            }

            var existingOptionNames = group.Options
                .Select(option => option.Name)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var optionSeed in seed.Options)
            {
                if (existingOptionNames.Contains(optionSeed.Name))
                {
                    continue;
                }

                newOptions.Add(new MenuItemOption
                {
                    Id = CreateSeedGuid(7, seed.Sequence * 100 + optionSeed.Sequence),
                    GroupId = group.Id,
                    MenuItemId = seed.MenuItemId,
                    RestaurantId = seed.RestaurantId,
                    Name = optionSeed.Name,
                    PriceAdjustment = optionSeed.PriceAdjustment,
                    AdjustmentType = optionSeed.AdjustmentType,
                    MaxQuantity = optionSeed.MaxQuantity,
                    StockQuantity = optionSeed.StockQuantity,
                    DisplayOrder = optionSeed.DisplayOrder,
                    IsAvailable = optionSeed.IsAvailable,
                    CreatedAt = DateTime.UtcNow.AddDays(-44)
                });
                existingOptionNames.Add(optionSeed.Name);
            }
        }

        if (newGroups.Count > 0)
        {
            await dbContext.MenuItemOptionGroups.AddRangeAsync(newGroups);
        }

        if (newOptions.Count > 0)
        {
            await dbContext.MenuItemOptions.AddRangeAsync(newOptions);
        }

        if (newGroups.Count > 0 || newOptions.Count > 0)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    private static IReadOnlyList<MenuOptionGroupSeed> BuildSeedMenuOptionGroups() =>
    [
        new("Veg Spring Rolls", 900001, "Dip", true, 1, 1, 1,
        [
            new(1, "Sweet chilli", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Mint chutney", 20, OptionAdjustmentType.Add, 1, 2),
            new(3, "Extra spicy dip", 20, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Veg Spring Rolls", 900002, "Add-ons", false, 0, 2, 2,
        [
            new(1, "Extra roll", 90, OptionAdjustmentType.Add, 3, 1),
            new(2, "Sesame sprinkle", 15, OptionAdjustmentType.Add, 1, 2)
        ]),
        // A required group: when the tracked sauce runs out the group must still be satisfiable from
        // the others, or the dish becomes unorderable without anything saying why.
        new("Chicken Wings", 900003, "Sauce", true, 1, 1, 1,
        [
            new(1, "Buffalo", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Smoky BBQ", 20, OptionAdjustmentType.Add, 1, 2),
            new(3, "Honey garlic", 30, OptionAdjustmentType.Add, 1, 3),
            new(4, "Reserve chilli oil", 40, OptionAdjustmentType.Add, 1, 4, true, 2)
        ]),
        new("Chicken Wings", 900004, "Heat level", true, 1, 1, 2,
        [
            new(1, "Mild", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Hot", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Extra hot", 10, OptionAdjustmentType.Add, 1, 3)
        ]),
        // Garlic Bread carries dish stock of its own, so the two limits meet here on purpose: a
        // tracked modifier can run out while the dish is still available, and the multiplication —
        // two breads each taking two shavings is four — is where a naive count oversells.
        new("Garlic Bread", 900005, "Finish", false, 0, 2, 1,
        [
            new(1, "Add mozzarella", 80, OptionAdjustmentType.Add, 1, 1),
            new(2, "Extra garlic butter", 25, OptionAdjustmentType.Add, 1, 2),
            new(3, "Chilli flakes", 0, OptionAdjustmentType.Add, 1, 3),
            // Up to two per bread, three left in the kitchen: one order of two leaves one, and the
            // next order of two is refused on the modifier while the bread itself is still there.
            new(4, "Truffle shavings", 250, OptionAdjustmentType.Add, 2, 4, true, 3),
            // Fewer left than one item may take, so asking for three is refused outright.
            new(5, "Last of the aioli", 60, OptionAdjustmentType.Add, 3, 5, true, 2)
        ]),
        new("Butter Chicken", 900006, "Spice level", true, 1, 1, 1,
        [
            new(1, "Mild", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Medium", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Hot", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Butter Chicken", 900007, "Side", true, 1, 1, 2,
        [
            new(1, "Steamed rice", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Butter naan", 120, OptionAdjustmentType.Add, 1, 2),
            new(3, "Garlic naan", 150, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Butter Chicken", 900008, "Extras", false, 0, 2, 3,
        [
            new(1, "Extra chicken", 180, OptionAdjustmentType.Add, 2, 1),
            new(2, "Extra gravy", 80, OptionAdjustmentType.Add, 2, 2)
        ]),
        new("Veg Fried Rice", 900009, "Protein", false, 0, 1, 1,
        [
            new(1, "Add egg", 80, OptionAdjustmentType.Add, 1, 1),
            new(2, "Add paneer", 120, OptionAdjustmentType.Add, 1, 2),
            new(3, "Add chicken", 160, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Veg Fried Rice", 900010, "Spice level", true, 1, 1, 2,
        [
            new(1, "No chilli", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Medium", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Spicy", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Grilled Salmon", 900011, "Doneness", true, 1, 1, 1,
        [
            new(1, "Medium", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Medium well", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Well done", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Grilled Salmon", 900012, "Sauce", true, 1, 1, 2,
        [
            new(1, "Lemon butter", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Garlic herb", 30, OptionAdjustmentType.Add, 1, 2),
            new(3, "Chilli glaze", 30, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Grilled Salmon", 900013, "Side", false, 0, 1, 3,
        [
            new(1, "Garden salad", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Chips", 80, OptionAdjustmentType.Add, 1, 2),
            new(3, "Steamed rice", 50, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Mushroom Pasta", 900014, "Sauce base", true, 1, 1, 1,
        [
            new(1, "Cream sauce", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Tomato sauce", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Garlic olive oil", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Mushroom Pasta", 900015, "Add-ons", false, 0, 3, 2,
        [
            new(1, "Extra mushrooms", 90, OptionAdjustmentType.Add, 2, 1),
            new(2, "Parmesan", 60, OptionAdjustmentType.Add, 2, 2),
            new(3, "Truffle oil", 140, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Mango Lassi", 900016, "Size", true, 1, 1, 1,
        [
            new(1, "Regular", 200, OptionAdjustmentType.Replace, 1, 1),
            new(2, "Large", 280, OptionAdjustmentType.Replace, 1, 2)
        ]),
        new("Mango Lassi", 900017, "Sweetness", true, 1, 1, 2,
        [
            new(1, "Less sweet", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Regular", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Extra sweet", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Masala Chai", 900018, "Milk", true, 1, 1, 1,
        [
            new(1, "Regular milk", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Oat milk", 40, OptionAdjustmentType.Add, 1, 2),
            new(3, "No milk", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Fresh Lime Soda", 900019, "Style", true, 1, 1, 1,
        [
            new(1, "Sweet", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Salted", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Sweet and salted", 0, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Fresh Lime Soda", 900020, "Size", true, 1, 1, 2,
        [
            new(1, "Regular", 150, OptionAdjustmentType.Replace, 1, 1),
            new(2, "Large", 210, OptionAdjustmentType.Replace, 1, 2)
        ]),
        new("Gulab Jamun", 900021, "Serve with", false, 0, 2, 1,
        [
            new(1, "Vanilla ice cream", 90, OptionAdjustmentType.Add, 1, 1),
            new(2, "Extra syrup", 30, OptionAdjustmentType.Add, 1, 2)
        ]),
        new("Chocolate Lava Cake", 900022, "Topping", false, 0, 2, 1,
        [
            new(1, "Vanilla ice cream", 90, OptionAdjustmentType.Add, 1, 1),
            new(2, "Berry compote", 70, OptionAdjustmentType.Add, 1, 2),
            new(3, "Extra chocolate sauce", 50, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Paneer Tikka Skewers", 900023, "Spice level", true, 1, 1, 1,
        [
            new(1, "Mild", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Medium", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "Fiery", 15, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Paneer Tikka Skewers", 900024, "Chutney", false, 0, 2, 2,
        [
            new(1, "Mint chutney", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Tamarind chutney", 20, OptionAdjustmentType.Add, 1, 2),
            new(3, "Extra onions", 15, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Corn Cheese Balls", 900025, "Dip", true, 1, 1, 1,
        [
            new(1, "Tomato ketchup", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Cheese sauce", 35, OptionAdjustmentType.Add, 1, 2),
            new(3, "Spicy mayo", 35, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Tandoori Chicken", 900026, "Portion", true, 1, 1, 1,
        [
            new(1, "Half", 590, OptionAdjustmentType.Replace, 1, 1),
            new(2, "Full", 1080, OptionAdjustmentType.Replace, 1, 2)
        ]),
        new("Tandoori Chicken", 900027, "Side", false, 0, 2, 2,
        [
            new(1, "Roomali roti", 90, OptionAdjustmentType.Add, 2, 1),
            new(2, "Onion salad", 40, OptionAdjustmentType.Add, 1, 2)
        ]),
        new("Smoky Paneer Sizzler", 900028, "Sauce", true, 1, 1, 1,
        [
            new(1, "Smoky masala", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Pepper cream", 60, OptionAdjustmentType.Add, 1, 2),
            new(3, "Chilli garlic", 40, OptionAdjustmentType.Add, 1, 3)
        ]),
        new("Rose Falooda", 900029, "Size", true, 1, 1, 1,
        [
            new(1, "Regular", 240, OptionAdjustmentType.Replace, 1, 1),
            new(2, "Large", 320, OptionAdjustmentType.Replace, 1, 2)
        ]),
        new("Masala Cola", 900030, "Ice", true, 1, 1, 1,
        [
            new(1, "Regular ice", 0, OptionAdjustmentType.Add, 1, 1),
            new(2, "Less ice", 0, OptionAdjustmentType.Add, 1, 2),
            new(3, "No ice", 0, OptionAdjustmentType.Add, 1, 3)
        ])
    ];

    private static IReadOnlyList<ResolvedMenuOptionGroupSeed> BuildGenericSeedMenuOptionGroups(
        Guid menuItemId,
        Guid restaurantId,
        int menuItemSequence)
    {
        var preferenceSequence = menuItemSequence * 10 + 1;
        var addOnSequence = menuItemSequence * 10 + 2;

        return
        [
            new(
                menuItemId,
                restaurantId,
                preferenceSequence,
                "Preparation",
                true,
                1,
                1,
                1,
                [
                    new(1, "Standard", 0, OptionAdjustmentType.Add, 1, 1),
                    new(2, "Light seasoning", 0, OptionAdjustmentType.Add, 1, 2),
                    new(3, "Extra seasoning", 1.00m, OptionAdjustmentType.Add, 1, 3)
                ]),
            new(
                menuItemId,
                restaurantId,
                addOnSequence,
                "Add-ons",
                false,
                0,
                3,
                2,
                [
                    new(1, "Extra sauce", 1.50m, OptionAdjustmentType.Add, 2, 1),
                    new(2, "Side salad", 4.00m, OptionAdjustmentType.Add, 1, 2),
                    new(3, "Gluten-free swap", 2.00m, OptionAdjustmentType.Add, 1, 3)
                ])
        ];
    }

    private static IReadOnlyDictionary<Guid, int> BuildDemoMenuItemSequences() =>
        Enumerable.Range(0, 9)
            .SelectMany(restaurantIndex => Enumerable.Range(0, 6)
                .Select(itemIndex => restaurantIndex * 100 + itemIndex + 1))
            .ToDictionary(sequence => CreateSeedGuid(5, sequence), sequence => sequence);

    private static string MenuOptionGroupKey(Guid menuItemId, string name) =>
        $"{menuItemId:N}|{name.Trim().ToUpperInvariant()}";

    private static Guid CreateSeedGuid(int group, int sequence)
    {
        return Guid.Parse($"d{group:0000000}-0000-0000-0000-{sequence:000000000000}");
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

    /// <param name="LegalBusinessName">Empty on purpose for a few seeds — see SeedPaginationDemoDataAsync.</param>
    /// <param name="Abn">Checksum-valid demo values, or empty to exercise the missing-identity paths.</param>
    private sealed record SeedRestaurant(
        Guid Id,
        string Name,
        string Address,
        string Phone,
        bool IsActive,
        string CoverItemName,
        string LegalBusinessName = "",
        string? Abn = null,
        bool GstRegistered = false,
        string BusinessContactEmail = "",
        string RefundContactEmail = "",
        string? CustomerSurchargeNotice = null);

    private sealed record DemoRefundSeed(
        int OrderSequence,
        PaymentRefundStatus Status,
        decimal AmountRatio,
        string Reason,
        string? FailureReason,
        string Slug);

    private sealed record SeedMenuItemProfile(
        string Description,
        decimal Price,
        bool IsVegetarian,
        bool IsVegan,
        bool IsGlutenFree,
        bool IsHalal,
        string? Allergens,
        int SpiceLevel,
        string ServingSize,
        int Calories,
        bool IsPopular,
        bool IsRecommended);

    private sealed record MenuOptionGroupSeed(
        string MenuItemName,
        int Sequence,
        string Name,
        bool IsRequired,
        int MinSelections,
        int MaxSelections,
        int DisplayOrder,
        IReadOnlyList<MenuOptionSeed> Options)
    {
        /// <summary>
        /// Places this group on one restaurant's menu item, with its option prices divided into that
        /// restaurant's currency.
        /// </summary>
        /// <remarks>
        /// The table below is written in the rupees this demo menu started in, and it is matched by
        /// dish name — so the same figures land on a restaurant trading in rupees and on one trading
        /// in dollars. Dividing here is what keeps a A$7 lassi from offering a A$280 "Large".
        /// </remarks>
        public ResolvedMenuOptionGroupSeed Resolve(Guid menuItemId, Guid restaurantId, decimal priceDivisor) =>
            new(
                menuItemId,
                restaurantId,
                Sequence,
                Name,
                IsRequired,
                MinSelections,
                MaxSelections,
                DisplayOrder,
                priceDivisor == 1m
                    ? Options
                    : Options
                        .Select(option => option with
                        {
                            PriceAdjustment = ConvertOptionPrice(option.PriceAdjustment, priceDivisor)
                        })
                        .ToArray());
    }

    private sealed record ResolvedMenuOptionGroupSeed(
        Guid MenuItemId,
        Guid RestaurantId,
        int Sequence,
        string Name,
        bool IsRequired,
        int MinSelections,
        int MaxSelections,
        int DisplayOrder,
        IReadOnlyList<MenuOptionSeed> Options);

    private sealed record MenuOptionSeed(
        int Sequence,
        string Name,
        decimal PriceAdjustment,
        OptionAdjustmentType AdjustmentType,
        int MaxQuantity,
        int DisplayOrder,
        bool IsAvailable = true,
        /// <summary>Units left of this modifier, or null when it is not counted.</summary>
        int? StockQuantity = null);

    private static int GetStableAvatarIndex(string value)
    {
        var sum = value.Aggregate(0, (current, character) => current + character);
        return sum % 4 + 1;
    }

    private static string? GetSeedMenuImageUrl(string itemName)
    {
        return ResolvedSeedMenuImageUrls.TryGetValue(itemName, out var imageUrl) ? imageUrl : null;
    }

    private static string? GetSeedRestaurantImageUrl(string imageSource)
    {
        imageSource = imageSource.Trim();

        if (imageSource.StartsWith("/", StringComparison.Ordinal) ||
            imageSource.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            imageSource.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return imageSource;
        }

        return GetSeedMenuImageUrl(imageSource);
    }

    private static bool IsSeedRestaurantImageUrl(string? imageUrl)
    {
        return !string.IsNullOrWhiteSpace(imageUrl) &&
            (imageUrl.Contains("/seed-menu/", StringComparison.OrdinalIgnoreCase) ||
                imageUrl.Contains("upload.wikimedia.org/wikipedia/commons/8/8a/Grilled_salmon.jpg", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The DineFlow Kitchen trades around the clock, unlike every other seeded restaurant.
    /// </summary>
    /// <remarks>
    /// <para>
    /// It is the restaurant everything gets tried against, and 09:00–21:00 in Adelaide means the
    /// demo is shut for most of a working day elsewhere — every session began by prising the hours
    /// open and ended by putting them back, which is both tedious and a good way to leave the data
    /// half-edited.
    /// </para>
    /// <para>
    /// 00:00 to 00:00 is how this system spells "all day"; see
    /// <c>RestaurantOperatingHoursService</c>, which treats an equal open and close as 24 hours
    /// rather than a zero-length window.
    /// </para>
    /// <para>
    /// Only this restaurant. The others keep ordinary trading hours so that closed-restaurant
    /// behaviour — refused orders, the auto-refund sweep — still has somewhere to be tested.
    /// </para>
    /// </remarks>
    private const string RestaurantOneAlwaysOpenJson =
        "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}," +
        "{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}]";

    /// <summary>
    /// The hours a restaurant is created with when nobody has said otherwise. Recognised so the
    /// migration below can tell "never touched" from "somebody set these on purpose".
    /// </summary>
    private const string UntouchedDefaultOpeningHoursJson =
        "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}," +
        "{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

    /// <summary>
    /// Menu prices for The DineFlow Kitchen, in Australian dollars.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The restaurant used to be in Kathmandu priced in rupees, which made it the one demo
    /// restaurant that could never connect Stripe — Stripe does not operate in Nepal, so
    /// "Connect Stripe" failed with country_unsupported however many times it was tried.
    /// </para>
    /// <para>
    /// These are what the dishes would cost in an Australian restaurant, not the rupee figures
    /// converted: A$2.71 for spring rolls is an exchange rate, not a price. Held in one place so a
    /// fresh database and a migrated one end up charging the same.
    /// </para>
    /// </remarks>
    private static readonly IReadOnlyDictionary<string, decimal> RestaurantOnePrices =
        new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase)
        {
            ["Veg Spring Rolls"] = 9.50m,
            ["Chicken Wings"] = 16.00m,
            ["Garlic Bread"] = 8.50m,
            ["Daily Soup"] = 9.00m,
            ["Butter Chicken"] = 24.00m,
            ["Veg Fried Rice"] = 15.00m,
            ["Grilled Salmon"] = 32.00m,
            ["Mushroom Pasta"] = 19.50m,
            ["Chef's Tasting Curry"] = 28.00m,
            ["Kitchen Staple Dal"] = 13.00m,
            ["Tandoori Platter"] = 34.00m,
            ["Mango Lassi"] = 7.00m,
            ["Masala Chai"] = 4.50m,
            ["Fresh Lime Soda"] = 5.50m,
            ["House Kombucha"] = 8.00m,
            ["Gulab Jamun"] = 8.00m,
            ["Chocolate Lava Cake"] = 12.50m,
            ["Seasonal Sorbet"] = 10.00m,
        };

    /// <summary>
    /// Stock levels for The DineFlow Kitchen, covering each state worth exercising by hand.
    /// </summary>
    /// <remarks>
    /// A null value means the dish is not stock-tracked and never runs out — the control case, and
    /// what every seeded dish used to be, which is why the stock system could not be tried at all
    /// without editing the database first.
    /// </remarks>
    private static readonly (string Name, int? Stock, bool SoldOut)[] StockTestingBaseline =
    [
        ("Veg Spring Rolls", null, false),      // untracked: unlimited, the control
        ("Butter Chicken", null, false),        // untracked
        ("Mango Lassi", null, false),           // untracked
        ("Gulab Jamun", null, false),           // untracked
        ("Masala Chai", 48, false),             // comfortable
        ("Kitchen Staple Dal", 60, false),      // comfortable
        ("Chicken Wings", 24, false),           // comfortable
        ("Fresh Lime Soda", 6, false),          // getting low
        ("Chocolate Lava Cake", 5, false),      // getting low
        ("Garlic Bread", 3, false),             // low
        ("Daily Soup", 2, false),               // one order of two empties it
        ("Veg Fried Rice", 1, false),           // last portion: race two checkouts at this one
        ("Tandoori Platter", 1, false),         // last portion
        ("Grilled Salmon", 0, true),            // ran out
        ("Seasonal Sorbet", 0, true),           // ran out
        ("Chef's Tasting Curry", 12, true),     // in stock but manually stopped: the flag must win
    ];

    /// <summary>
    /// Gives an existing demo database the stock levels above, once.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The main demo block only runs against a completely empty database, so a developer who
    /// already has one would never see these values. This fills them in — but only when the
    /// restaurant has no stock-tracked dish at all, because stock is operational data: rewriting it
    /// on every start would wipe out whatever state a test was in the middle of.
    /// </para>
    /// <para>
    /// That condition doubles as the way to start over. Clear every stock count on this restaurant
    /// and the next start rebuilds the baseline.
    /// </para>
    /// </remarks>
    /// <summary>
    /// Rupee figures divided by this land close to the Australian prices above.
    /// </summary>
    /// <remarks>
    /// Only used for the demo order history, where what matters is that the numbers stay in
    /// proportion to each other and stop reading as A$9,250 for dinner.
    /// </remarks>
    private const decimal RupeeToAudDivisor = 27m;

    /// <summary>
    /// Moves The DineFlow Kitchen from Nepal to Australia in a database that already exists.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The demo menu is only built against an empty database, so changing the seed alone would
    /// leave every existing developer with the restaurant that can never connect Stripe. Runs once,
    /// keyed on the country still being NP, and leaves a restaurant somebody has already moved
    /// themselves alone.
    /// </para>
    /// <para>
    /// The order history is rescaled rather than left behind. Its amounts were rupees; relabelling
    /// the currency without touching them would put A$9,250 dinners into the revenue reports.
    /// </para>
    /// </remarks>
    internal static async Task MigrateRestaurantOneToAustraliaAsync(AppDbContext dbContext)
    {
        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == RestaurantOneId);

        if (restaurant is null || !string.Equals(restaurant.CountryCode, "NP", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        restaurant.CountryCode = "AU";
        restaurant.Currency = "AUD";
        restaurant.Timezone = "Australia/Adelaide";
        restaurant.Address = "42 Flavour Street, Adelaide SA 5000";
        restaurant.Phone = "+61-8-8100-4242";
        restaurant.UpdatedAt = DateTime.UtcNow;

        var menuItems = await dbContext.MenuItems
            .Where(item => item.RestaurantId == RestaurantOneId)
            .ToListAsync();

        foreach (var item in menuItems)
        {
            if (RestaurantOnePrices.TryGetValue(item.Name, out var price))
            {
                item.Price = price;
                item.UpdatedAt = DateTime.UtcNow;
            }
        }

        await RescaleRestaurantOneOrderHistoryAsync(dbContext);
        await dbContext.SaveChangesAsync();
    }

    /// <summary>
    /// Brings the demo order history into the same currency as the menu.
    /// </summary>
    /// <remarks>
    /// Line prices are scaled and the order total is then rebuilt from them, rather than scaling the
    /// total separately — otherwise a receipt would show lines that do not add up to what it says
    /// at the bottom. Payment rows follow the order they belong to for the same reason.
    /// </remarks>
    private static async Task RescaleRestaurantOneOrderHistoryAsync(AppDbContext dbContext)
    {
        var orders = await dbContext.Orders
            .Include(order => order.OrderItems)
            .Include(order => order.Payments)
            .Where(order => order.RestaurantId == RestaurantOneId)
            .ToListAsync();

        foreach (var order in orders)
        {
            foreach (var line in order.OrderItems)
            {
                line.UnitPrice = Math.Round(line.UnitPrice / RupeeToAudDivisor, 2, MidpointRounding.AwayFromZero);

                foreach (var option in line.SelectedOptions)
                {
                    option.PriceAdjustmentSnapshot = Math.Round(
                        option.PriceAdjustmentSnapshot / RupeeToAudDivisor, 2, MidpointRounding.AwayFromZero);
                }
            }

            order.TotalAmount = order.OrderItems.Count > 0
                ? order.OrderItems.Sum(line => line.UnitPrice * line.Quantity)
                : Math.Round(order.TotalAmount / RupeeToAudDivisor, 2, MidpointRounding.AwayFromZero);

            foreach (var payment in order.Payments)
            {
                payment.Currency = "aud";
                payment.AmountCents = (long)Math.Round(order.TotalAmount * 100m, MidpointRounding.AwayFromZero);
                payment.UpdatedAt = DateTime.UtcNow;
            }
        }
    }

    /// <summary>
    /// Opens The DineFlow Kitchen around the clock in a database that already exists.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Keyed on the hours still being the ones a restaurant is created with. Anyone who has set
    /// their own — a closed day, a split lunch and dinner service — keeps them; the point is to fix
    /// the default, not to overrule a decision.
    /// </para>
    /// <para>
    /// That also makes it reversible: set the hours back to 09:00–21:00 every day and the next
    /// start opens them again, which is the same escape hatch the stock baseline has.
    /// </para>
    /// </remarks>
    internal static async Task OpenRestaurantOneAllDayAsync(AppDbContext dbContext)
    {
        var restaurant = await dbContext.Restaurants
            .FirstOrDefaultAsync(item => item.Id == RestaurantOneId);

        if (restaurant is null ||
            !string.Equals(restaurant.OpeningHoursJson, UntouchedDefaultOpeningHoursJson, StringComparison.Ordinal))
        {
            return;
        }

        restaurant.OpeningHoursJson = RestaurantOneAlwaysOpenJson;
        restaurant.UpdatedAt = DateTime.UtcNow;
        await dbContext.SaveChangesAsync();
    }

    internal static async Task SeedStockTestingBaselineAsync(AppDbContext dbContext)
    {
        var items = await dbContext.MenuItems
            .Where(item => item.RestaurantId == RestaurantOneId)
            .ToListAsync();

        if (items.Count == 0 || items.Any(item => item.StockQuantity != null))
        {
            return;
        }

        items.AddRange(await AddMissingStockTestingDishesAsync(dbContext, items));

        var itemsByName = items
            .GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var changed = false;

        foreach (var (name, stock, soldOut) in StockTestingBaseline)
        {
            if (!itemsByName.TryGetValue(name, out var item) || stock is null)
            {
                continue;
            }

            item.StockQuantity = stock;
            item.IsSoldOut = soldOut;
            item.UpdatedAt = DateTime.UtcNow;
            changed = true;
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    /// <summary>
    /// What each of The DineFlow Kitchen's dishes declares about allergens.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every seeded dish declared nothing at all, so the panel a customer reads before ordering had
    /// only ever been seen saying "not declared" — the one state it is least important to get right.
    /// Wording follows the Australian labelling vocabulary the rest of this menu assumes.
    /// </para>
    /// <para>
    /// The spread is deliberate, so each branch of the panel can be reached from the menu: dishes
    /// that declare allergens outright, one that only warns what it may contain, one that describes
    /// its kitchen but declares no allergen, and two that declare nothing — the control, and the
    /// case that must never read as "free from everything".
    /// </para>
    /// </remarks>
    private static readonly (string Name, string? Contains, string? MayContain, string? CrossContact)[]
        RestaurantOneAllergens =
    [
        ("Butter Chicken", "Milk, cashew (tree nut)", "Wheat (gluten)",
            "Cooked in a kitchen that also handles wheat, peanut and sesame."),
        ("Chicken Wings", "Wheat (gluten), soy", "Egg, sesame",
            "Fried in oil shared with battered seafood."),
        ("Veg Spring Rolls", "Wheat (gluten), soy, sesame", "Egg",
            "Fried in oil shared with battered seafood."),
        ("Garlic Bread", "Wheat (gluten), milk", null,
            "Baked on trays shared with sesame-topped breads."),
        ("Grilled Salmon", "Fish", "Milk", null),
        ("Mushroom Pasta", "Wheat (gluten), milk, egg", null,
            "Prepared on a bench shared with tree nuts."),
        ("Chocolate Lava Cake", "Milk, egg, wheat (gluten), soy", "Tree nuts",
            "Made in a kitchen that also handles peanut."),
        ("Gulab Jamun", "Milk, wheat (gluten)", "Tree nuts", null),
        ("Mango Lassi", "Milk", null, null),
        ("Masala Chai", "Milk", null, null),
        ("Veg Fried Rice", "Soy, sesame", "Egg", null),
        ("Tandoori Platter", "Milk", "Tree nuts, sesame",
            "Cooked in a tandoor shared with wheat breads."),
        ("Chef's Tasting Curry", "Milk, cashew (tree nut), mustard", "Peanut",
            "The tasting menu changes weekly and the kitchen handles every major allergen."),
        // Declares no allergen but warns what it may contain: the panel must lead with that.
        ("Kitchen Staple Dal", null, "Milk",
            "Simmered in pans shared with dairy-based curries."),
        ("Seasonal Sorbet", null, "Milk, tree nuts", null),
        // Describes its kitchen but declares no allergen. A cross-contact statement is not an
        // allergen answer and must not be summarised as one.
        ("Daily Soup", null, null, "The recipe changes daily — ask staff before ordering."),
        // The controls: nothing declared at all.
        ("Fresh Lime Soda", null, null, null),
        ("House Kombucha", null, null, null),
    ];

    /// <summary>
    /// What a modifier itself contains, keyed by dish, group and option.
    /// </summary>
    /// <remarks>
    /// The point of the panel recomputing as options are ticked is that adding naan to a dairy-only
    /// curry adds gluten. Without these there was nothing on the menu that could demonstrate it.
    /// </remarks>
    private static readonly (string Dish, string Group, string Option, string? Contains, string? MayContain)[]
        RestaurantOneOptionAllergens =
    [
        ("Butter Chicken", "Side", "Butter naan", "Wheat (gluten), milk", null),
        ("Butter Chicken", "Side", "Garlic naan", "Wheat (gluten), milk", null),
        ("Butter Chicken", "Extras", "Extra gravy", "Milk, cashew (tree nut)", null),
        ("Chicken Wings", "Sauce", "Honey garlic", "Sesame", null),
        ("Chicken Wings", "Sauce", "Smoky BBQ", null, "Mustard"),
        ("Veg Spring Rolls", "Dip", "Mint chutney", null, "Peanut"),
        ("Veg Spring Rolls", "Add-ons", "Sesame sprinkle", "Sesame", null),
        ("Veg Fried Rice", "Protein", "Add egg", "Egg", null),
        ("Veg Fried Rice", "Protein", "Add paneer", "Milk", null),
        ("Mushroom Pasta", "Add-ons", "Parmesan", "Milk", null),
        ("Mushroom Pasta", "Add-ons", "Truffle oil", null, "Tree nuts"),
        ("Garlic Bread", "Finish", "Add mozzarella", "Milk", null),
        ("Chocolate Lava Cake", "Topping", "Vanilla ice cream", "Milk, egg", "Tree nuts"),
        ("Masala Chai", "Milk", "Oat milk", "Oats (gluten)", null),
        // Declares nothing, so a plate can be assembled that adds no allergen of its own.
        ("Masala Chai", "Milk", "No milk", null, null),
    ];

    /// <summary>
    /// Gives an existing demo database the declarations above.
    /// </summary>
    /// <remarks>
    /// Only fills a dish or option that declares nothing at all, so a restaurant that has entered
    /// its own is never overwritten — the same restraint the stock and opening-hours baselines show,
    /// and the same escape hatch: clear all three fields and the next start fills them again.
    /// </remarks>
    internal static async Task SeedRestaurantOneAllergensAsync(AppDbContext dbContext)
    {
        static bool DeclaresNothing(string? contains, string? mayContain, string? crossContact) =>
            string.IsNullOrWhiteSpace(contains)
            && string.IsNullOrWhiteSpace(mayContain)
            && string.IsNullOrWhiteSpace(crossContact);

        var items = await dbContext.MenuItems
            .Where(item => item.RestaurantId == RestaurantOneId)
            .ToListAsync();

        if (items.Count == 0)
        {
            return;
        }

        var itemsByName = items
            .GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
        var changed = false;

        foreach (var (name, contains, mayContain, crossContact) in RestaurantOneAllergens)
        {
            if (!itemsByName.TryGetValue(name, out var item)
                || !DeclaresNothing(item.Allergens, item.MayContainAllergens, item.CrossContactStatement))
            {
                continue;
            }

            item.Allergens = contains;
            item.MayContainAllergens = mayContain;
            item.CrossContactStatement = crossContact;
            item.UpdatedAt = DateTime.UtcNow;
            changed = true;
        }

        var options = await dbContext.MenuItemOptions
            .Where(option => option.RestaurantId == RestaurantOneId)
            .Join(
                dbContext.MenuItemOptionGroups,
                option => option.GroupId,
                group => group.Id,
                (option, group) => new { Option = option, GroupName = group.Name })
            .Join(
                dbContext.MenuItems,
                row => row.Option.MenuItemId,
                menuItem => menuItem.Id,
                (row, menuItem) => new { row.Option, row.GroupName, DishName = menuItem.Name })
            .ToListAsync();

        var optionsByKey = options
            .GroupBy(row => SeededOptionKey(row.DishName, row.GroupName, row.Option.Name))
            .ToDictionary(group => group.Key, group => group.First().Option);

        foreach (var (dish, group, option, contains, mayContain) in RestaurantOneOptionAllergens)
        {
            if (!optionsByKey.TryGetValue(SeededOptionKey(dish, group, option), out var row)
                || !DeclaresNothing(row.Allergens, row.MayContainAllergens, row.CrossContactStatement))
            {
                continue;
            }

            row.Allergens = contains;
            row.MayContainAllergens = mayContain;
            row.UpdatedAt = DateTime.UtcNow;
            changed = true;
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    /// <summary>
    /// The dishes that exist only to be tested against, and the category each belongs in.
    /// </summary>
    private static readonly (string Name, string Category, string Description, decimal Price, int Order, string Image)[]
        StockTestingDishes =
    [
        ("Kitchen Staple Dal", "Main Course", "Plenty in stock: the control for anything stock-tracked", 290m, 6, "Veg Fried Rice"),
        ("Tandoori Platter", "Main Course", "One portion left: for last-one and two-customers-at-once tests", 780m, 7, "Butter Chicken"),
        ("Daily Soup", "Starters", "Two portions: ordering both should flip it to sold out", 210m, 4, "Garlic Bread"),
        ("Seasonal Sorbet", "Desserts", "Zero stock: should refuse to be added to a cart", 260m, 3, "Gulab Jamun"),
    ];

    /// <summary>
    /// Creates any stock-testing dish this database does not have yet, and returns the new rows.
    /// </summary>
    /// <remarks>
    /// A database seeded before these dishes existed would otherwise be missing exactly the cases
    /// worth trying, since the main demo block only ever runs against an empty database.
    /// </remarks>
    internal static async Task<List<MenuItem>> AddMissingStockTestingDishesAsync(
        AppDbContext dbContext,
        IReadOnlyCollection<MenuItem> existingItems)
    {
        var existingNames = existingItems
            .Select(item => item.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = StockTestingDishes
            .Where(dish => !existingNames.Contains(dish.Name))
            .ToArray();

        if (missing.Length == 0)
        {
            return [];
        }

        var categories = await dbContext.MenuCategories
            .Where(category => category.RestaurantId == RestaurantOneId)
            .ToListAsync();
        var categoriesByName = categories
            .GroupBy(category => category.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

        var created = new List<MenuItem>();

        foreach (var dish in missing)
        {
            if (!categoriesByName.TryGetValue(dish.Category, out var category))
            {
                // A renamed or removed category is the developer's own menu, not something to
                // second-guess by inventing one.
                continue;
            }

            created.Add(new MenuItem
            {
                Id = Guid.NewGuid(),
                RestaurantId = RestaurantOneId,
                CategoryId = category.Id,
                Name = dish.Name,
                Description = dish.Description,
                Price = dish.Price,
                DisplayOrder = dish.Order,
                IsAvailable = true,
                ImageUrl = GetSeedMenuImageUrl(dish.Image),
                CreatedAt = DateTime.UtcNow
            });
        }

        if (created.Count > 0)
        {
            await dbContext.MenuItems.AddRangeAsync(created);
            await dbContext.SaveChangesAsync();
        }

        return created;
    }

    private static async Task BackfillSeedMenuImagesAsync(AppDbContext dbContext)
    {
        var seedItemNames = SeedMenuImageUrls.Keys.ToArray();
        var seedImageUrlMap = SeedMenuImageUrls
            .Where(seed => ResolvedSeedMenuImageUrls.ContainsKey(seed.Key))
            .ToDictionary(
                seed => seed.Value,
                seed => ResolvedSeedMenuImageUrls[seed.Key],
                StringComparer.OrdinalIgnoreCase);
        var localSeedImageUrls = seedImageUrlMap.Keys.ToArray();
        var existingSeedItems = await dbContext.MenuItems
            .Where(item =>
                seedItemNames.Contains(item.Name) ||
                (item.ImageUrl != null && localSeedImageUrls.Contains(item.ImageUrl)))
            .ToListAsync();

        if (existingSeedItems.Count == 0)
        {
            return;
        }

        foreach (var item in existingSeedItems)
        {
            var imageUrl = GetSeedMenuImageUrl(item.Name);

            if (imageUrl is null &&
                item.ImageUrl is not null &&
                seedImageUrlMap.TryGetValue(item.ImageUrl, out var migratedImageUrl))
            {
                imageUrl = migratedImageUrl;
            }

            if (imageUrl is not null &&
                !string.Equals(item.ImageUrl, imageUrl, StringComparison.OrdinalIgnoreCase))
            {
                item.ImageUrl = imageUrl;
                item.UpdatedAt = DateTime.UtcNow;
            }
        }

        await dbContext.SaveChangesAsync();
    }

    private static async Task<IReadOnlyDictionary<string, string>> ResolveSeedMenuImageUrlsAsync(
        IServiceProvider serviceProvider,
        IConfiguration configuration)
    {
        if (!IsS3StorageEnabled(configuration))
        {
            return SeedMenuImageUrls;
        }

        var logger = serviceProvider
            .GetService<ILoggerFactory>()?
            .CreateLogger("DineFlow.Infrastructure.Identity.IdentitySeeder");
        var s3Client = serviceProvider.GetService<IAmazonS3>();

        if (s3Client is null)
        {
            logger?.LogWarning("S3 seed menu image upload skipped because IAmazonS3 is not registered.");
            return SeedMenuImageUrls;
        }

        var hostEnvironment = serviceProvider.GetService<IHostEnvironment>();
        var seedMenuDirectory = ResolveSeedMenuDirectory(hostEnvironment?.ContentRootPath);

        if (!Directory.Exists(seedMenuDirectory))
        {
            logger?.LogWarning("S3 seed menu image upload skipped because {SeedMenuDirectory} was not found.", seedMenuDirectory);
            return SeedMenuImageUrls;
        }

        var bucket = configuration["AvatarStorage:Bucket"]?.Trim() ?? string.Empty;
        var resolvedUrls = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var seedImage in SeedMenuImageUrls)
        {
            var objectKey = seedImage.Value.TrimStart('/').Replace('\\', '/');
            var filePath = Path.Combine(seedMenuDirectory, Path.GetFileName(objectKey));

            if (!File.Exists(filePath))
            {
                logger?.LogWarning("Seed menu image {FilePath} was not found; keeping local URL {ImageUrl}.", filePath, seedImage.Value);
                resolvedUrls[seedImage.Key] = seedImage.Value;
                continue;
            }

            await EnsureSeedMenuImageObjectAsync(s3Client, bucket, objectKey, filePath);
            resolvedUrls[seedImage.Key] = BuildSeedMenuImagePublicUrl(configuration, objectKey);
        }

        return resolvedUrls;
    }

    private static bool IsS3StorageEnabled(IConfiguration configuration)
    {
        return string.Equals(configuration["AvatarStorage:Provider"], "S3", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(configuration["AvatarStorage:Bucket"]);
    }

    private static string ResolveSeedMenuDirectory(string? contentRootPath)
    {
        var candidateRoots = new[]
        {
            contentRootPath,
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory
        };

        foreach (var root in candidateRoots.Where(root => !string.IsNullOrWhiteSpace(root)))
        {
            var seedMenuDirectory = Path.Combine(root!, "wwwroot", "seed-menu");

            if (Directory.Exists(seedMenuDirectory))
            {
                return seedMenuDirectory;
            }
        }

        return Path.Combine(contentRootPath ?? Directory.GetCurrentDirectory(), "wwwroot", "seed-menu");
    }

    private static async Task EnsureSeedMenuImageObjectAsync(
        IAmazonS3 s3Client,
        string bucket,
        string objectKey,
        string filePath)
    {
        await using var fileStream = File.OpenRead(filePath);
        await s3Client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = objectKey,
            InputStream = fileStream,
            ContentType = "image/svg+xml"
        });
    }

    private static string BuildSeedMenuImagePublicUrl(IConfiguration configuration, string objectKey)
    {
        var publicBaseUrl = configuration["AvatarStorage:PublicBaseUrl"];

        if (!string.IsNullOrWhiteSpace(publicBaseUrl))
        {
            return $"{publicBaseUrl.TrimEnd('/')}/{objectKey}";
        }

        var bucket = configuration["AvatarStorage:Bucket"]?.Trim() ?? string.Empty;
        var region = configuration["AvatarStorage:Region"]?.Trim();

        if (string.IsNullOrWhiteSpace(region))
        {
            region = "ap-southeast-2";
        }

        return $"https://{bucket}.s3.{region}.amazonaws.com/{objectKey}";
    }

    private static async Task BackfillSeedOrderItemNameSnapshotsAsync(AppDbContext dbContext)
    {
        var orderItems = await dbContext.OrderItems
            .Where(item => item.MenuItemNameSnapshot == string.Empty && item.MenuItemId.HasValue)
            .ToListAsync();
        var hasChanges = false;

        if (orderItems.Count > 0)
        {
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

                orderItem.MenuItemNameSnapshot = menuItemName;
                orderItem.UpdatedAt = DateTime.UtcNow;
                hasChanges = true;
            }
        }

        var demoOrders = await dbContext.Orders
            .Include(order => order.OrderItems)
            .Where(order => order.OrderNumber.StartsWith("DEMO-") &&
                order.OrderItems.Any(item => item.MenuItemNameSnapshot == string.Empty))
            .ToListAsync();

        foreach (var order in demoOrders)
        {
            var orderedItems = order.OrderItems
                .OrderBy(item => item.CreatedAt)
                .ThenBy(item => item.Id)
                .ToList();

            for (var itemIndex = 0; itemIndex < orderedItems.Count; itemIndex++)
            {
                var orderItem = orderedItems[itemIndex];
                if (!string.IsNullOrWhiteSpace(orderItem.MenuItemNameSnapshot) ||
                    !TryGetDemoOrderItemSnapshot(order.OrderNumber, itemIndex, out var itemName, out var basePrice))
                {
                    continue;
                }

                orderItem.MenuItemNameSnapshot = itemName;
                if (orderItem.BasePriceSnapshot <= 0)
                {
                    orderItem.BasePriceSnapshot = basePrice;
                }

                orderItem.UpdatedAt = DateTime.UtcNow;
                hasChanges = true;
            }
        }

        if (hasChanges)
        {
            await dbContext.SaveChangesAsync();
        }
    }

    private static bool TryGetDemoOrderItemSnapshot(
        string orderNumber,
        int itemIndex,
        out string itemName,
        out decimal basePrice)
    {
        itemName = string.Empty;
        basePrice = 0;

        if (!orderNumber.StartsWith("DEMO-", StringComparison.OrdinalIgnoreCase) ||
            !int.TryParse(orderNumber["DEMO-".Length..], out var sequence) ||
            sequence < 1)
        {
            return false;
        }

        var orderIndex = sequence - 1;
        var itemNameIndex = itemIndex switch
        {
            0 => orderIndex % DemoOrderItemNames.Length,
            1 => (orderIndex * 5 + 3) % DemoOrderItemNames.Length,
            _ => -1
        };

        if (itemNameIndex < 0)
        {
            return false;
        }

        itemName = DemoOrderItemNames[itemNameIndex];
        basePrice = DemoOrderItemPrices[itemNameIndex];
        return true;
    }
}
