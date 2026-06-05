using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Restaurant;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using DineFlow.Infrastructure.Payments;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderStatusHistory> OrderStatusHistories => Set<OrderStatusHistory>();
    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<RestaurantTable> RestaurantTables => Set<RestaurantTable>();
    public DbSet<RestaurantEntity> Restaurants => Set<RestaurantEntity>();

    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<TestPaymentOrder> TestPaymentOrders => Set<TestPaymentOrder>();
    public DbSet<UserPasskey> UserPasskeys => Set<UserPasskey>();
    public DbSet<UserMfaSettings> UserMfaSettings => Set<UserMfaSettings>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<UserPasskey>(entity =>
        {
            entity.HasKey(passkey => passkey.Id);

            entity.Property(passkey => passkey.CredentialId)
                .IsRequired();

            entity.Property(passkey => passkey.PublicKey)
                .IsRequired();

            entity.Property(passkey => passkey.UserHandle)
                .IsRequired();

            entity.Property(passkey => passkey.DeviceName)
                .HasMaxLength(120);

            entity.Property(passkey => passkey.CredentialType)
                .HasMaxLength(32);

            entity.Property(passkey => passkey.Transports)
                .HasMaxLength(256);

            entity.HasIndex(passkey => passkey.CredentialId)
                .IsUnique();

            entity.HasIndex(passkey => passkey.UserId);

            entity.HasOne(passkey => passkey.User)
                .WithMany()
                .HasForeignKey(passkey => passkey.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<UserMfaSettings>(entity =>
        {
            entity.HasKey(settings => settings.UserId);

            entity.Property(settings => settings.TotpSecret)
                .HasMaxLength(512);

            entity.Property(settings => settings.PreferredMethod)
                .HasMaxLength(32)
                .HasDefaultValue(MfaMethods.Totp)
                .IsRequired();

            entity.HasOne(settings => settings.User)
                .WithOne()
                .HasForeignKey<UserMfaSettings>(settings => settings.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Order>(entity =>
        {
            entity.HasKey(order => order.Id);

            entity.HasIndex(order => order.RestaurantId);

            entity.HasIndex(order => order.CustomerId);

            entity.HasMany(order => order.OrderItems)
                .WithOne(item => item.Order)
                .HasForeignKey(item => item.OrderId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(order => order.Payments)
                .WithOne(payment => payment.Order)
                .HasForeignKey(payment => payment.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<OrderItem>(entity =>
        {
            entity.HasKey(item => item.Id);

            entity.HasIndex(item => item.OrderId);
        });

        builder.Entity<Payment>(entity =>
        {
            entity.HasKey(payment => payment.Id);

            entity.Property(payment => payment.Provider)
                .HasMaxLength(64)
                .IsRequired();

            entity.Property(payment => payment.ProviderCheckoutSessionId)
                .HasMaxLength(255);

            entity.Property(payment => payment.ProviderPaymentIntentId)
                .HasMaxLength(255);

            entity.Property(payment => payment.Currency)
                .HasMaxLength(8)
                .IsRequired();

            entity.Property(payment => payment.FailureReason)
                .HasMaxLength(1_000);

            entity.HasIndex(payment => payment.OrderId);

            entity.HasIndex(payment => payment.ProviderCheckoutSessionId);

            entity.HasIndex(payment => payment.ProviderPaymentIntentId);
        });

        builder.Entity<TestPaymentOrder>(entity =>
        {
            entity.HasKey(order => order.Id);

            entity.Property(order => order.UserId)
                .HasMaxLength(450);

            entity.Property(order => order.Name)
                .HasMaxLength(180)
                .IsRequired();

            entity.Property(order => order.Currency)
                .HasMaxLength(8)
                .IsRequired();

            entity.Property(order => order.Status)
                .HasMaxLength(32)
                .IsRequired();

            entity.Property(order => order.StripeCheckoutSessionId)
                .HasMaxLength(255);

            entity.Property(order => order.StripePaymentIntentId)
                .HasMaxLength(255);

            entity.HasIndex(order => order.StripeCheckoutSessionId)
                .IsUnique();

            entity.HasIndex(order => order.UserId);
        });
    }
}
