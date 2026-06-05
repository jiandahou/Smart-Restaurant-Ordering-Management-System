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

            await dbContext.Restaurants.AddRangeAsync(restaurantOne, restaurantTwo);
            await dbContext.SaveChangesAsync();

            // ── Tables (Restaurant One) ──────────────────────────────────────
            var tables = new List<RestaurantTable>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T1", QrToken = Guid.NewGuid().ToString("N"), Capacity = 2, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T2", QrToken = Guid.NewGuid().ToString("N"), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T3", QrToken = Guid.NewGuid().ToString("N"), Capacity = 4, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T4", QrToken = Guid.NewGuid().ToString("N"), Capacity = 6, IsActive = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, TableNumber = "T5", QrToken = Guid.NewGuid().ToString("N"), Capacity = 8, IsActive = true },
            };

            await dbContext.RestaurantTables.AddRangeAsync(tables);

            // ── Menu categories & items (Restaurant One) ─────────────────────
            var starters = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Starters",    Description = "Light bites to kick things off",       DisplayOrder = 1, IsActive = true };
            var mains    = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Main Course", Description = "Hearty dishes for every appetite",      DisplayOrder = 2, IsActive = true };
            var drinks   = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Drinks",      Description = "Hot, cold, and everything in between",  DisplayOrder = 3, IsActive = true };
            var desserts = new MenuCategory { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, Name = "Desserts",    Description = "Sweet endings",                         DisplayOrder = 4, IsActive = true };

            await dbContext.MenuCategories.AddRangeAsync(starters, mains, drinks, desserts);
            await dbContext.SaveChangesAsync();

            var menuItems = new List<MenuItem>
            {
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Veg Spring Rolls",    Description = "Crispy rolls stuffed with seasoned veggies",              Price = 250, DisplayOrder = 1, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Chicken Wings",       Description = "Spicy buffalo wings with dipping sauce",                  Price = 450, DisplayOrder = 2, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = starters.Id, Name = "Garlic Bread",        Description = "Toasted bread with garlic butter",                        Price = 180, DisplayOrder = 3, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Butter Chicken",      Description = "Tender chicken in creamy tomato sauce, served with naan", Price = 650, DisplayOrder = 1, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Veg Fried Rice",      Description = "Wok-tossed rice with mixed vegetables",                   Price = 380, DisplayOrder = 2, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Grilled Salmon",      Description = "Pan-seared salmon with lemon butter sauce",               Price = 950, DisplayOrder = 3, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = mains.Id,    Name = "Mushroom Pasta",      Description = "Creamy fettuccine with sautéed mushrooms",               Price = 480, DisplayOrder = 4, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Mango Lassi",         Description = "Chilled yogurt drink blended with fresh mango",           Price = 200, DisplayOrder = 1, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Masala Chai",         Description = "Spiced milk tea brewed the traditional way",              Price = 120, DisplayOrder = 2, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = drinks.Id,   Name = "Fresh Lime Soda",     Description = "Sparkling water with fresh lime and a pinch of salt",     Price = 150, DisplayOrder = 3, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Gulab Jamun",         Description = "Soft milk-solid dumplings soaked in rose syrup",          Price = 180, DisplayOrder = 1, IsAvailable = true },
                new() { Id = Guid.NewGuid(), RestaurantId = RestaurantOneId, CategoryId = desserts.Id, Name = "Chocolate Lava Cake", Description = "Warm cake with a molten chocolate centre",                Price = 320, DisplayOrder = 2, IsAvailable = true },
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
            preparingOrder.OrderItems.Add(new OrderItem { Id = Guid.NewGuid(), OrderId = preparingOrder.Id, MenuItemId = menuItems.First(m => m.Name == "Fresh Lime Soda").Id, Quantity = 1, UnitPrice = 150, Note = "Extra ice", CreatedAt = preparingOrder.CreatedAt });

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

            await dbContext.Orders.AddRangeAsync(completedOrder, preparingOrder, pendingOrder, takeawayOrder);
            await dbContext.SaveChangesAsync();
        }

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

            new SeedUser("customer.one@dineflow.test",   "Customer One",   ApplicationRoles.Customer, null),
            new SeedUser("customer.two@dineflow.test",   "Customer Two",   ApplicationRoles.Customer, null),
            new SeedUser("customer.three@dineflow.test", "Customer Three", ApplicationRoles.Customer, null),
            new SeedUser("customer.four@dineflow.test",  "Customer Four",  ApplicationRoles.Customer, null),
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
}
