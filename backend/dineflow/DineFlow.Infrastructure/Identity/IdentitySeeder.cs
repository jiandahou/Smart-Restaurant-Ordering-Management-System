using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DineFlow.Infrastructure.Identity;
public static class IdentitySeeder
{
    public static async Task SeedAsync(IServiceProvider serviceProvider)
    {
        using var scope = serviceProvider.CreateScope();

        var roleManager = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();

        string[] roles = { "PlatformOwner", "RestaurantOwner", "Admin", "Staff", "Customer" };

        foreach (var role in roles)
        {
            if (!await roleManager.RoleExistsAsync(role))
            {
                await roleManager.CreateAsync(new IdentityRole(role));
            }
        }

        var ownerEmail = configuration["SeedOwner:Email"];
        var ownerPassword = configuration["SeedOwner:Password"];
        var ownerFullName = configuration["SeedOwner:FullName"] ?? "DineFlow Owner";

        if (string.IsNullOrWhiteSpace(ownerEmail) || string.IsNullOrWhiteSpace(ownerPassword))
        {
            return;
        }

        var existingOwner = await userManager.FindByEmailAsync(ownerEmail);

        if (existingOwner is not null)
        {
            return;
        }

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