using DineFlow.Infrastructure.Carts;
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
    public DbSet<Cart> Carts => Set<Cart>();
    public DbSet<CartItem> CartItems => Set<CartItem>();
    public DbSet<CartParticipant> CartParticipants => Set<CartParticipant>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderItemOption> OrderItemOptions => Set<OrderItemOption>();
    public DbSet<OrderStatusHistory> OrderStatusHistories => Set<OrderStatusHistory>();
    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<MenuItemOptionGroup> MenuItemOptionGroups => Set<MenuItemOptionGroup>();
    public DbSet<MenuItemOption> MenuItemOptions => Set<MenuItemOption>();
    public DbSet<RestaurantTable> RestaurantTables => Set<RestaurantTable>();
    public DbSet<RestaurantEntity> Restaurants => Set<RestaurantEntity>();

    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<UserPasskey> UserPasskeys => Set<UserPasskey>();
    public DbSet<UserMfaSettings> UserMfaSettings => Set<UserMfaSettings>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<UserPasskey>(entity =>
        {
            entity.HasKey(passkey => passkey.Id);
            entity.Property(passkey => passkey.CredentialId).IsRequired();
            entity.Property(passkey => passkey.PublicKey).IsRequired();
            entity.Property(passkey => passkey.UserHandle).IsRequired();
            entity.Property(passkey => passkey.DeviceName).HasMaxLength(120);
            entity.Property(passkey => passkey.CredentialType).HasMaxLength(32);
            entity.Property(passkey => passkey.Transports).HasMaxLength(256);
            entity.HasIndex(passkey => passkey.CredentialId).IsUnique();
            entity.HasIndex(passkey => passkey.UserId);
            entity.HasOne(passkey => passkey.User)
                .WithMany()
                .HasForeignKey(passkey => passkey.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<UserMfaSettings>(entity =>
        {
            entity.HasKey(settings => settings.UserId);
            entity.Property(settings => settings.TotpSecret).HasMaxLength(512);
            entity.Property(settings => settings.PreferredMethod)
                .HasMaxLength(32)
                .HasDefaultValue(MfaMethods.Totp)
                .IsRequired();
            entity.HasOne(settings => settings.User)
                .WithOne()
                .HasForeignKey<UserMfaSettings>(settings => settings.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

              builder.Entity<RestaurantTable>(entity =>
        {
            entity.HasKey(table => table.Id);

            entity.Property(table => table.TableNumber)
                .HasMaxLength(40)
                .IsRequired();

            entity.Property(table => table.QrToken)
                .HasMaxLength(64)
                .IsRequired();

            entity.HasIndex(table => table.QrToken)
                .IsUnique();

            entity.HasIndex(table => table.RestaurantId);

            entity.ToTable(table => table.HasCheckConstraint(
                "CK_RestaurantTables_QrToken_NotEmpty",
                "length(\"QrToken\") > 0"));
        });

        builder.Entity<MenuItem>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.HasIndex(item => item.RestaurantId);
            entity.HasIndex(item => item.CategoryId);
            entity.HasMany(item => item.OptionGroups)
                .WithOne(group => group.MenuItem)
                .HasForeignKey(group => group.MenuItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<MenuItemOptionGroup>(entity =>
        {
            entity.HasKey(group => group.Id);
            entity.Property(group => group.Name)
                .HasMaxLength(120)
                .IsRequired();
            entity.HasIndex(group => group.MenuItemId);
            entity.HasIndex(group => group.RestaurantId);
            entity.HasMany(group => group.Options)
                .WithOne(option => option.Group)
                .HasForeignKey(option => option.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<MenuItemOption>(entity =>
        {
            entity.HasKey(option => option.Id);
            entity.Property(option => option.Name)
                .HasMaxLength(120)
                .IsRequired();
            entity.Property(option => option.PriceAdjustment)
                .HasColumnType("numeric(10,2)");
            entity.HasIndex(option => option.GroupId);
            entity.HasIndex(option => option.MenuItemId);
            entity.HasIndex(option => option.RestaurantId);
        });

        builder.Entity<Cart>(entity =>
        {
            entity.HasKey(cart => cart.Id);

            entity.Property(cart => cart.CustomerNote)
                .HasMaxLength(4_000);

            entity.HasIndex(cart => cart.RestaurantId);
            entity.HasIndex(cart => cart.TableId);
            entity.HasIndex(cart => cart.OrderId)
                .IsUnique();
            entity.HasIndex(cart => cart.ExpiresAt);

            entity.HasIndex(cart => cart.TableId)
                .IsUnique()
                .HasDatabaseName("IX_Carts_TableId_Active")
                .HasFilter("\"Status\" = 0 AND \"TableId\" IS NOT NULL");

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_Carts_Status",
                    "\"Status\" IN (0, 1, 2)");
                table.HasCheckConstraint(
                    "CK_Carts_OrderType",
                    "\"OrderType\" IN (0, 1, 2)");
                table.HasCheckConstraint(
                    "CK_Carts_ExpiresAt",
                    "\"ExpiresAt\" > \"CreatedAt\"");
                table.HasCheckConstraint(
                    "CK_Carts_TableOrderType",
                    "\"TableId\" IS NULL OR \"OrderType\" = 0");
            });

            entity.HasOne(cart => cart.Restaurant)
                .WithMany()
                .HasForeignKey(cart => cart.RestaurantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(cart => cart.Table)
                .WithMany()
                .HasForeignKey(cart => cart.TableId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(cart => cart.Order)
                .WithOne()
                .HasForeignKey<Cart>(cart => cart.OrderId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasMany(cart => cart.Items)
                .WithOne(item => item.Cart)
                .HasForeignKey(item => item.CartId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasMany(cart => cart.Participants)
                .WithOne(participant => participant.Cart)
                .HasForeignKey(participant => participant.CartId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CartItem>(entity =>
        {
            entity.HasKey(item => item.Id);

            entity.Property(item => item.Note)
                .HasMaxLength(2_000);

            entity.HasIndex(item => item.CartId);
            entity.HasIndex(item => item.MenuItemId);
            entity.HasIndex(item => new { item.CartId, item.MenuItemId });

            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CartItems_Quantity",
                "\"Quantity\" > 0"));

            entity.HasOne(item => item.MenuItem)
                .WithMany()
                .HasForeignKey(item => item.MenuItemId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<CartParticipant>(entity =>
        {
            entity.HasKey(participant => participant.Id);

            entity.Property(participant => participant.ParticipantTokenHash)
                .HasMaxLength(32)
                .IsFixedLength()
                .IsRequired();

            entity.Property(participant => participant.CustomerId)
                .HasMaxLength(450);

            entity.HasIndex(participant => participant.CartId);
            entity.HasIndex(participant => participant.CustomerId);
            entity.HasIndex(participant => participant.ParticipantTokenHash)
                .IsUnique();

            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CartParticipants_TokenHashLength",
                "octet_length(\"ParticipantTokenHash\") = 32"));

            entity.HasOne(participant => participant.Customer)
                .WithMany()
                .HasForeignKey(participant => participant.CustomerId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<Order>(entity =>
        {
            entity.HasKey(order => order.Id);

            entity.Property(order => order.CustomerId)
                .HasMaxLength(450);

            entity.Property(order => order.OrderNumber)
                .HasMaxLength(40)
                .IsRequired();

            entity.HasIndex(order => order.RestaurantId);
            entity.HasIndex(order => order.CustomerId);

            entity.HasIndex(order => order.OrderNumber)
                .IsUnique();

            entity.HasOne(order => order.Restaurant)
                .WithMany()
                .HasForeignKey(order => order.RestaurantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(order => order.Table)
                .WithMany()
                .HasForeignKey(order => order.TableId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(order => order.Customer)
                .WithMany()
                .HasForeignKey(order => order.CustomerId)
                .OnDelete(DeleteBehavior.SetNull);

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
            entity.Property(item => item.MenuItemNameSnapshot).HasMaxLength(240).IsRequired();
            entity.Property(item => item.BasePriceSnapshot).HasColumnType("numeric(10,2)");
            entity.Property(item => item.UnitPrice).HasColumnType("numeric(10,2)");
            entity.HasIndex(item => item.OrderId);
            entity.HasMany(item => item.SelectedOptions)
                .WithOne(opt => opt.OrderItem)
                .HasForeignKey(opt => opt.OrderItemId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<OrderItemOption>(entity =>
        {
            entity.HasKey(opt => opt.Id);
            entity.Property(opt => opt.GroupNameSnapshot).HasMaxLength(120).IsRequired();
            entity.Property(opt => opt.OptionNameSnapshot).HasMaxLength(120).IsRequired();
            entity.Property(opt => opt.PriceAdjustmentSnapshot).HasColumnType("numeric(10,2)");
            entity.HasIndex(opt => opt.OrderItemId);
        });

        builder.Entity<Payment>(entity =>
        {
            entity.HasKey(payment => payment.Id);
            entity.Property(payment => payment.Provider).HasMaxLength(64).IsRequired();
            entity.Property(payment => payment.ProviderCheckoutSessionId).HasMaxLength(255);
            entity.Property(payment => payment.ProviderPaymentIntentId).HasMaxLength(255);
            entity.Property(payment => payment.Currency).HasMaxLength(8).IsRequired();
            entity.Property(payment => payment.FailureReason).HasMaxLength(1_000);
            entity.HasIndex(payment => payment.OrderId);
            entity.HasIndex(payment => payment.ProviderCheckoutSessionId);
            entity.HasIndex(payment => payment.ProviderPaymentIntentId);
        });

    }
}
