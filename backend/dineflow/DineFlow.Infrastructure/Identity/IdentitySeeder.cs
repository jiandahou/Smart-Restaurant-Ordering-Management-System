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
    public static async Task SeedAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // ── Roles ────────────────────────────────────────────────────────────
        string[] roles = { "PlatformOwner", "RestaurantOwner", "Admin", "Staff", "Customer" };
        foreach (var role in roles)
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole(role));
        }

        // ── Platform owner ───────────────────────────────────────────────────
        var ownerEmail = configuration["SeedOwner:Email"];
        var ownerPassword = configuration["SeedOwner:Password"];
        var ownerFullName = configuration["SeedOwner:FullName"] ?? "DineFlow Owner";

        if (!string.IsNullOrWhiteSpace(ownerEmail) && !string.IsNullOrWhiteSpace(ownerPassword))
        {
            if (await userManager.FindByEmailAsync(ownerEmail) is null)
            {
                var owner = new ApplicationUser
                {
                    UserName = ownerEmail,
                    Email = ownerEmail,
                    FullName = ownerFullName,
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

                await userManager.AddToRoleAsync(owner, "PlatformOwner");
            }
        }

        // ── Restaurant ───────────────────────────────────────────────────────
        if (await dbContext.Restaurants.AnyAsync())
            return;

        var restaurant = new RestaurantEntity
        {
            Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
            Name = "The DineFlow Kitchen",
            Address = "42 Flavor Street, Kathmandu 44600",
            Phone = "+977-1-4567890",
            Timezone = "Asia/Kathmandu",
            Currency = "NPR",
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };

        await dbContext.Restaurants.AddAsync(restaurant);
        await dbContext.SaveChangesAsync();

        // ── Tables ───────────────────────────────────────────────────────────
        var tables = new List<RestaurantTable>
        {
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, TableNumber = "T1", QrToken = Guid.NewGuid().ToString("N"), Capacity = 2, IsActive = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, TableNumber = "T2", QrToken = Guid.NewGuid().ToString("N"), Capacity = 4, IsActive = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, TableNumber = "T3", QrToken = Guid.NewGuid().ToString("N"), Capacity = 4, IsActive = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, TableNumber = "T4", QrToken = Guid.NewGuid().ToString("N"), Capacity = 6, IsActive = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, TableNumber = "T5", QrToken = Guid.NewGuid().ToString("N"), Capacity = 8, IsActive = true },
        };

        await dbContext.RestaurantTables.AddRangeAsync(tables);

        // ── Menu categories & items ──────────────────────────────────────────
        var starters = new MenuCategory
        {
            Id = Guid.NewGuid(), RestaurantId = restaurant.Id,
            Name = "Starters", Description = "Light bites to kick things off",
            DisplayOrder = 1, IsActive = true
        };

        var mains = new MenuCategory
        {
            Id = Guid.NewGuid(), RestaurantId = restaurant.Id,
            Name = "Main Course", Description = "Hearty dishes for every appetite",
            DisplayOrder = 2, IsActive = true
        };

        var drinks = new MenuCategory
        {
            Id = Guid.NewGuid(), RestaurantId = restaurant.Id,
            Name = "Drinks", Description = "Hot, cold, and everything in between",
            DisplayOrder = 3, IsActive = true
        };

        var desserts = new MenuCategory
        {
            Id = Guid.NewGuid(), RestaurantId = restaurant.Id,
            Name = "Desserts", Description = "Sweet endings",
            DisplayOrder = 4, IsActive = true
        };

        await dbContext.MenuCategories.AddRangeAsync(starters, mains, drinks, desserts);
        await dbContext.SaveChangesAsync();

        var menuItems = new List<MenuItem>
        {
            // Starters
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = starters.Id, Name = "Veg Spring Rolls", Description = "Crispy rolls stuffed with seasoned veggies", Price = 250, DisplayOrder = 1, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = starters.Id, Name = "Chicken Wings", Description = "Spicy buffalo wings with dipping sauce", Price = 450, DisplayOrder = 2, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = starters.Id, Name = "Garlic Bread", Description = "Toasted bread with garlic butter", Price = 180, DisplayOrder = 3, IsAvailable = true },

            // Mains
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = mains.Id, Name = "Butter Chicken", Description = "Tender chicken in creamy tomato sauce, served with naan", Price = 650, DisplayOrder = 1, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = mains.Id, Name = "Veg Fried Rice", Description = "Wok-tossed rice with mixed vegetables", Price = 380, DisplayOrder = 2, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = mains.Id, Name = "Grilled Salmon", Description = "Pan-seared salmon with lemon butter sauce", Price = 950, DisplayOrder = 3, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = mains.Id, Name = "Mushroom Pasta", Description = "Creamy fettuccine with sautéed mushrooms", Price = 480, DisplayOrder = 4, IsAvailable = true },

            // Drinks
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = drinks.Id, Name = "Mango Lassi", Description = "Chilled yogurt drink blended with fresh mango", Price = 200, DisplayOrder = 1, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = drinks.Id, Name = "Masala Chai", Description = "Spiced milk tea brewed the traditional way", Price = 120, DisplayOrder = 2, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = drinks.Id, Name = "Fresh Lime Soda", Description = "Sparkling water with fresh lime and a pinch of salt", Price = 150, DisplayOrder = 3, IsAvailable = true },

            // Desserts
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = desserts.Id, Name = "Gulab Jamun", Description = "Soft milk-solid dumplings soaked in rose syrup", Price = 180, DisplayOrder = 1, IsAvailable = true },
            new() { Id = Guid.NewGuid(), RestaurantId = restaurant.Id, CategoryId = desserts.Id, Name = "Chocolate Lava Cake", Description = "Warm cake with a molten chocolate centre", Price = 320, DisplayOrder = 2, IsAvailable = true },
        };

        await dbContext.MenuItems.AddRangeAsync(menuItems);

        // ── Restaurant admin user ────────────────────────────────────────────
        const string adminEmail = "admin@dineflow.com";
        const string adminPassword = "Admin@1234";

        if (await userManager.FindByEmailAsync(adminEmail) is null)
        {
            var admin = new ApplicationUser
            {
                UserName = adminEmail,
                Email = adminEmail,
                FullName = "Restaurant Admin",
                RestaurantId = restaurant.Id,
                EmailConfirmed = true,
                CreatedAt = DateTime.UtcNow
            };

            var result = await userManager.CreateAsync(admin, adminPassword);
            if (result.Succeeded)
                await userManager.AddToRoleAsync(admin, "Admin");
        }

        await dbContext.SaveChangesAsync();

        // ── Orders ───────────────────────────────────────────────────────────
        var adminUser = await userManager.FindByEmailAsync(adminEmail);
        var adminUserId = adminUser?.Id;

        var completedOrder = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            TableId = tables[0].Id,
            OrderNumber = "ORD-0001",
            OrderType = OrderType.DineIn,
            Status = OrderStatus.Completed,
            TotalAmount = 1100,
            CustomerNote = "No onions please",
            CreatedAt = DateTime.UtcNow.AddHours(-3)
        };

        completedOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = completedOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Butter Chicken").Id,
            Quantity = 1,
            UnitPrice = 650,
            CreatedAt = completedOrder.CreatedAt
        });
        completedOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = completedOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Mango Lassi").Id,
            Quantity = 2,
            UnitPrice = 200,
            CreatedAt = completedOrder.CreatedAt
        });
        completedOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = completedOrder.Id,
            PreviousStatus = OrderStatus.Pending,
            NewStatus = OrderStatus.Accepted,
            ChangedByUserId = adminUserId,
            CreatedAt = completedOrder.CreatedAt.AddMinutes(2)
        });
        completedOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = completedOrder.Id,
            PreviousStatus = OrderStatus.Accepted,
            NewStatus = OrderStatus.Preparing,
            ChangedByUserId = adminUserId,
            CreatedAt = completedOrder.CreatedAt.AddMinutes(5)
        });
        completedOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = completedOrder.Id,
            PreviousStatus = OrderStatus.Preparing,
            NewStatus = OrderStatus.Completed,
            ChangedByUserId = adminUserId,
            CreatedAt = completedOrder.CreatedAt.AddMinutes(25)
        });

        var preparingOrder = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            TableId = tables[1].Id,
            OrderNumber = "ORD-0002",
            OrderType = OrderType.DineIn,
            Status = OrderStatus.Preparing,
            TotalAmount = 810,
            CreatedAt = DateTime.UtcNow.AddMinutes(-20)
        };

        preparingOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = preparingOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Grilled Salmon").Id,
            Quantity = 1,
            UnitPrice = 950,
            CreatedAt = preparingOrder.CreatedAt
        });
        preparingOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = preparingOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Fresh Lime Soda").Id,
            Quantity = 1,
            UnitPrice = 150,
            Note = "Extra ice",
            CreatedAt = preparingOrder.CreatedAt
        });
        preparingOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = preparingOrder.Id,
            PreviousStatus = OrderStatus.Pending,
            NewStatus = OrderStatus.Accepted,
            ChangedByUserId = adminUserId,
            CreatedAt = preparingOrder.CreatedAt.AddMinutes(1)
        });
        preparingOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = preparingOrder.Id,
            PreviousStatus = OrderStatus.Accepted,
            NewStatus = OrderStatus.Preparing,
            ChangedByUserId = adminUserId,
            CreatedAt = preparingOrder.CreatedAt.AddMinutes(4)
        });

        var pendingOrder = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            TableId = tables[2].Id,
            OrderNumber = "ORD-0003",
            OrderType = OrderType.DineIn,
            Status = OrderStatus.Pending,
            TotalAmount = 930,
            CustomerNote = "Allergic to peanuts",
            CreatedAt = DateTime.UtcNow.AddMinutes(-5)
        };

        pendingOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = pendingOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Chicken Wings").Id,
            Quantity = 1,
            UnitPrice = 450,
            CreatedAt = pendingOrder.CreatedAt
        });
        pendingOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = pendingOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Mushroom Pasta").Id,
            Quantity = 1,
            UnitPrice = 480,
            CreatedAt = pendingOrder.CreatedAt
        });

        var takeawayOrder = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = restaurant.Id,
            TableId = null,
            OrderNumber = "ORD-0004",
            OrderType = OrderType.Takeaway,
            Status = OrderStatus.Ready,
            TotalAmount = 700,
            CreatedAt = DateTime.UtcNow.AddMinutes(-10)
        };

        takeawayOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = takeawayOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Veg Fried Rice").Id,
            Quantity = 1,
            UnitPrice = 380,
            CreatedAt = takeawayOrder.CreatedAt
        });
        takeawayOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = takeawayOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Garlic Bread").Id,
            Quantity = 1,
            UnitPrice = 180,
            CreatedAt = takeawayOrder.CreatedAt
        });
        takeawayOrder.OrderItems.Add(new OrderItem
        {
            Id = Guid.NewGuid(),
            OrderId = takeawayOrder.Id,
            MenuItemId = menuItems.First(m => m.Name == "Masala Chai").Id,
            Quantity = 1,
            UnitPrice = 120,
            CreatedAt = takeawayOrder.CreatedAt
        });
        takeawayOrder.StatusHistory.Add(new OrderStatusHistory
        {
            Id = Guid.NewGuid(),
            OrderId = takeawayOrder.Id,
            PreviousStatus = OrderStatus.Pending,
            NewStatus = OrderStatus.Ready,
            ChangedByUserId = adminUserId,
            CreatedAt = takeawayOrder.CreatedAt.AddMinutes(8)
        });

        await dbContext.Orders.AddRangeAsync(completedOrder, preparingOrder, pendingOrder, takeawayOrder);
        await dbContext.SaveChangesAsync();
    }
}
