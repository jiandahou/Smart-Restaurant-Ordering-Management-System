using DineFlow.Application.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

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

        foreach (var role in ApplicationRoles.All)
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                await roleManager.CreateAsync(new IdentityRole(role));
            }
        }

        var ownerEmail = configuration["SeedOwner:Email"];
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

        var seedPassword = configuration["SeedUsers:Password"] ?? "DineFlow123!";
        var seedUsers = new[]
        {
            new SeedUser("owner.one@dineflow.test", "Restaurant One Owner", ApplicationRoles.RestaurantOwner, RestaurantOneId),
            new SeedUser("owner.two@dineflow.test", "Restaurant Two Owner", ApplicationRoles.RestaurantOwner, RestaurantTwoId),

            new SeedUser("admin.one.a@dineflow.test", "Restaurant One Admin A", ApplicationRoles.Admin, RestaurantOneId),
            new SeedUser("admin.one.b@dineflow.test", "Restaurant One Admin B", ApplicationRoles.Admin, RestaurantOneId),
            new SeedUser("admin.two.a@dineflow.test", "Restaurant Two Admin A", ApplicationRoles.Admin, RestaurantTwoId),
            new SeedUser("admin.two.b@dineflow.test", "Restaurant Two Admin B", ApplicationRoles.Admin, RestaurantTwoId),

            new SeedUser("staff.one.a@dineflow.test", "Restaurant One Staff A", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.b@dineflow.test", "Restaurant One Staff B", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.c@dineflow.test", "Restaurant One Staff C", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.one.d@dineflow.test", "Restaurant One Staff D", ApplicationRoles.Staff, RestaurantOneId),
            new SeedUser("staff.two.a@dineflow.test", "Restaurant Two Staff A", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.b@dineflow.test", "Restaurant Two Staff B", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.c@dineflow.test", "Restaurant Two Staff C", ApplicationRoles.Staff, RestaurantTwoId),
            new SeedUser("staff.two.d@dineflow.test", "Restaurant Two Staff D", ApplicationRoles.Staff, RestaurantTwoId),

            new SeedUser("customer.one@dineflow.test", "Customer One", ApplicationRoles.Customer, null),
            new SeedUser("customer.two@dineflow.test", "Customer Two", ApplicationRoles.Customer, null),
            new SeedUser("customer.three@dineflow.test", "Customer Three", ApplicationRoles.Customer, null),
            new SeedUser("customer.four@dineflow.test", "Customer Four", ApplicationRoles.Customer, null)
        };

        foreach (var seedUser in seedUsers)
        {
            await UpsertUserAsync(userManager, seedUser, seedPassword);
        }
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
            var removePasswordResult = await userManager.RemovePasswordAsync(user);

            if (!removePasswordResult.Succeeded)
            {
                var errors = string.Join(", ", removePasswordResult.Errors.Select(e => e.Description));
                throw new Exception($"Failed to remove password for {user.Email}: {errors}");
            }
        }

        var addPasswordResult = await userManager.AddPasswordAsync(user, password);

        if (!addPasswordResult.Succeeded)
        {
            var errors = string.Join(", ", addPasswordResult.Errors.Select(e => e.Description));
            throw new Exception($"Failed to set password for {user.Email}: {errors}");
        }
    }

    private static async Task EnsureRoleAsync(
        UserManager<ApplicationUser> userManager,
        ApplicationUser user,
        string role)
    {
        if (await userManager.IsInRoleAsync(user, role))
        {
            return;
        }

        var roleResult = await userManager.AddToRoleAsync(user, role);

        if (!roleResult.Succeeded)
        {
            var errors = string.Join(", ", roleResult.Errors.Select(e => e.Description));
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
