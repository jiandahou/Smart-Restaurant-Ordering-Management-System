using DineFlow.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Infrastructure.Persistence;

public class AppDbContext : IdentityDbContext<ApplicationUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    // Later you will add business tables here:
    // public DbSet<Restaurant> Restaurants => Set<Restaurant>();
    // public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    // public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    // public DbSet<Order> Orders => Set<Order>();
    // public DbSet<OrderItem> OrderItems => Set<OrderItem>();
}