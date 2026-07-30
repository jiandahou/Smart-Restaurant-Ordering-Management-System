using DineFlow.Infrastructure.Carts;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Menu;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Restaurant;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Printing;
using DineFlow.Infrastructure.Reporting;
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
    public DbSet<RestaurantPickupCounter> RestaurantPickupCounters => Set<RestaurantPickupCounter>();
    public DbSet<MenuCategory> MenuCategories => Set<MenuCategory>();
    public DbSet<MenuItem> MenuItems => Set<MenuItem>();
    public DbSet<MenuItemOptionGroup> MenuItemOptionGroups => Set<MenuItemOptionGroup>();
    public DbSet<MenuItemOption> MenuItemOptions => Set<MenuItemOption>();
    public DbSet<RestaurantTable> RestaurantTables => Set<RestaurantTable>();
    public DbSet<TableSession> TableSessions => Set<TableSession>();
    public DbSet<RestaurantEntity> Restaurants => Set<RestaurantEntity>();

    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<PaymentRefund> PaymentRefunds => Set<PaymentRefund>();
    public DbSet<PaymentRefundRequest> PaymentRefundRequests => Set<PaymentRefundRequest>();
    public DbSet<StripeWebhookEvent> StripeWebhookEvents => Set<StripeWebhookEvent>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<OrderEventLog> OrderEventLogs => Set<OrderEventLog>();
    public DbSet<PaymentEventLog> PaymentEventLogs => Set<PaymentEventLog>();
    public DbSet<UserPasskey> UserPasskeys => Set<UserPasskey>();
    public DbSet<UserMfaSettings> UserMfaSettings => Set<UserMfaSettings>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<PrintJob> PrintJobs => Set<PrintJob>();
    public DbSet<PrintStation> PrintStations => Set<PrintStation>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        EnsureReportLogsAreAppendOnly();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(
        bool acceptAllChangesOnSuccess,
        CancellationToken cancellationToken = default)
    {
        EnsureReportLogsAreAppendOnly();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

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

        builder.Entity<RefreshToken>(entity =>
        {
            entity.HasKey(refreshToken => refreshToken.Id);
            entity.Property(refreshToken => refreshToken.TokenHash)
                .HasMaxLength(128)
                .IsRequired();
            entity.Property(refreshToken => refreshToken.CreatedByIp).HasMaxLength(64);
            entity.Property(refreshToken => refreshToken.RevokedByIp).HasMaxLength(64);
            entity.Property(refreshToken => refreshToken.ReplacedByTokenHash).HasMaxLength(128);
            entity.HasIndex(refreshToken => refreshToken.TokenHash).IsUnique();
            entity.HasIndex(refreshToken => refreshToken.UserId);
            entity.HasOne(refreshToken => refreshToken.User)
                .WithMany()
                .HasForeignKey(refreshToken => refreshToken.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PrintStation>(entity =>
        {
            entity.HasKey(station => station.Id);
            entity.Property(station => station.StationKey).HasMaxLength(120).IsRequired();
            entity.Property(station => station.Name).HasMaxLength(160).IsRequired();
            entity.Property(station => station.LeaseOwner).HasMaxLength(120);
            entity.Property(station => station.QzStatus).HasMaxLength(40);
            entity.Property(station => station.PrinterStatus).HasMaxLength(80);
            entity.Property(station => station.PrinterName).HasMaxLength(240);
            entity.Property(station => station.ConnectionType).HasMaxLength(80);
            entity.Property(station => station.QzVersion).HasMaxLength(40);
            entity.Property(station => station.LastError).HasMaxLength(2_000);
            entity.HasIndex(station => new { station.RestaurantId, station.StationKey }).IsUnique();
            entity.HasIndex(station => station.LastSeenAt);
        });

        builder.Entity<PrintJob>(entity =>
        {
            entity.HasKey(job => job.Id);
            entity.Property(job => job.DeduplicationKey).HasMaxLength(240).IsRequired();
            entity.Property(job => job.LastError).HasMaxLength(2_000);
            entity.Property(job => job.LastStatusDetail).HasMaxLength(2_000);
            entity.Property(job => job.CreatedByUserId).HasMaxLength(450);
            entity.HasIndex(job => job.DeduplicationKey).IsUnique();
            entity.HasIndex(job => new { job.RestaurantId, job.State, job.NextAttemptAt });
            entity.HasIndex(job => new { job.OrderId, job.TicketRevision });
            entity.HasIndex(job => job.LeaseExpiresAt);
            entity.HasOne(job => job.Order)
                .WithMany()
                .HasForeignKey(job => job.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(job => job.Station)
                .WithMany(station => station.Jobs)
                .HasForeignKey(job => job.StationId)
                .OnDelete(DeleteBehavior.SetNull);
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

        builder.Entity<RestaurantEntity>(entity =>
        {
            entity.Property(restaurant => restaurant.ImageUrl)
                .HasMaxLength(2048);

            entity.Property(restaurant => restaurant.StripeAccountId)
                .HasMaxLength(255);

            entity.Property(restaurant => restaurant.StripeRequirementsDueJson)
                .HasDefaultValue("[]")
                .IsRequired();

            entity.Property(restaurant => restaurant.OneTimePlatformFeeCheckoutSessionId)
                .HasMaxLength(255);

            entity.Property(restaurant => restaurant.OneTimePlatformFeePaymentIntentId)
                .HasMaxLength(255);

            entity.Property(restaurant => restaurant.OneTimePlatformFeeCheckoutUrl)
                .HasMaxLength(2_048);

            entity.Property(restaurant => restaurant.OneTimePlatformFeeIdempotencyKey)
                .HasMaxLength(255);

            entity.HasIndex(restaurant => restaurant.StripeAccountId)
                .IsUnique();

            entity.Property(restaurant => restaurant.CountryCode)
                .HasMaxLength(2)
                .HasDefaultValue("AU")
                .IsRequired();

            entity.Property(restaurant => restaurant.AcceptingOrders)
                .HasDefaultValue(true);

            entity.Property(restaurant => restaurant.OpeningHoursJson)
                .HasDefaultValue("[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]")
                .IsRequired();

            entity.Property(restaurant => restaurant.SpecialOpeningDaysJson)
                .HasDefaultValue("[]")
                .IsRequired();

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_Restaurants_OrderPlatformFeeBps",
                    "\"OrderPlatformFeeBps\" >= 0 AND \"OrderPlatformFeeBps\" <= 10000");
                table.HasCheckConstraint(
                    "CK_Restaurants_OneTimePlatformFeeCents",
                    "\"OneTimePlatformFeeCents\" >= 0");
                table.HasCheckConstraint(
                    "CK_Restaurants_OneTimePlatformFeeStatus",
                    "\"OneTimePlatformFeeStatus\" IN (0, 1, 2, 3)");
            });
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

            // The dashboard widget reads only the watched items for one restaurant.
            entity.HasIndex(item => new { item.RestaurantId, item.IsWatched })
                .HasDatabaseName("IX_MenuItems_RestaurantId_IsWatched")
                .HasFilter("\"IsWatched\"");

            entity.ToTable(table =>
            {
                // Stock is opt-in: NULL means untracked, never negative when tracked.
                table.HasCheckConstraint(
                    "CK_MenuItems_StockQuantity",
                    "\"StockQuantity\" IS NULL OR \"StockQuantity\" >= 0");
            });

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
            entity.HasIndex(cart => cart.TableSessionId);
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

            entity.HasOne(cart => cart.TableSession)
                .WithMany()
                .HasForeignKey(cart => cart.TableSessionId)
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

            entity.Property(item => item.SelectedOptionIds)
                .HasColumnType("uuid[]")
                .HasDefaultValueSql("ARRAY[]::uuid[]");

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

            entity.Property(order => order.TicketRevision)
                .HasDefaultValue(1);

            entity.HasIndex(order => order.RestaurantId);
            entity.HasIndex(order => order.CustomerId);
            entity.HasIndex(order => order.TableSessionId);

            entity.HasIndex(order => order.OrderNumber)
                .IsUnique();

            entity.HasIndex(order => new { order.RestaurantId, order.PickupDate, order.PickupNumber })
                .IsUnique()
                .HasDatabaseName("IX_Orders_RestaurantId_PickupDate_PickupNumber")
                .HasFilter("\"RestaurantId\" IS NOT NULL AND \"PickupDate\" IS NOT NULL AND \"PickupNumber\" IS NOT NULL");

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_Orders_PaymentMethod",
                    "\"PaymentMethod\" IN (0, 1)");
                table.HasCheckConstraint(
                    "CK_Orders_PickupNumber",
                    "\"PickupNumber\" IS NULL OR \"PickupNumber\" > 0");
                table.HasCheckConstraint(
                    "CK_Orders_PickupPair",
                    "(\"PickupDate\" IS NULL AND \"PickupNumber\" IS NULL) OR (\"PickupDate\" IS NOT NULL AND \"PickupNumber\" IS NOT NULL)");
            });

            entity.HasOne(order => order.Restaurant)
                .WithMany()
                .HasForeignKey(order => order.RestaurantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(order => order.Table)
                .WithMany()
                .HasForeignKey(order => order.TableId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(order => order.TableSession)
                .WithMany(session => session.Orders)
                .HasForeignKey(order => order.TableSessionId)
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

        builder.Entity<RestaurantPickupCounter>(entity =>
        {
            entity.HasKey(counter => new { counter.RestaurantId, counter.PickupDate });

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_RestaurantPickupCounters_LastNumber",
                    "\"LastNumber\" > 0");
            });
        });

        builder.Entity<TableSession>(entity =>
        {
            entity.HasKey(session => session.Id);

            entity.HasIndex(session => session.RestaurantId);
            entity.HasIndex(session => session.TableId);
            entity.HasIndex(session => session.Status);
            entity.HasIndex(session => new { session.TableId, session.Status })
                .IsUnique()
                .HasDatabaseName("IX_TableSessions_TableId_Open")
                .HasFilter("\"Status\" = 0");

            entity.ToTable(table =>
            {
                table.HasCheckConstraint(
                    "CK_TableSessions_Status",
                    "\"Status\" IN (0, 1)");
                table.HasCheckConstraint(
                    "CK_TableSessions_ClosedAt",
                    "\"ClosedAt\" IS NULL OR \"ClosedAt\" >= \"OpenedAt\"");
            });

            entity.HasOne(session => session.Restaurant)
                .WithMany()
                .HasForeignKey(session => session.RestaurantId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(session => session.Table)
                .WithMany()
                .HasForeignKey(session => session.TableId)
                .OnDelete(DeleteBehavior.Restrict);
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

        builder.Entity<OrderStatusHistory>(entity =>
        {
            entity.Property(history => history.Action)
                .HasMaxLength(40)
                .IsRequired();

            entity.Property(history => history.Reason)
                .HasMaxLength(1_000);

            entity.Property(history => history.ChangedByUserId)
                .HasMaxLength(450);

            entity.HasIndex(history => new { history.OrderId, history.CreatedAt });
        });

        builder.Entity<Payment>(entity =>
        {
            entity.HasKey(payment => payment.Id);
            entity.Property(payment => payment.Provider).HasMaxLength(64).IsRequired();
            entity.Property(payment => payment.ProviderCheckoutSessionId).HasMaxLength(255);
            entity.Property(payment => payment.ProviderPaymentIntentId).HasMaxLength(255);
            entity.Property(payment => payment.StripeAccountId).HasMaxLength(255);
            entity.Property(payment => payment.CheckoutUrl).HasMaxLength(2_048);
            entity.Property(payment => payment.IdempotencyKey).HasMaxLength(255);
            entity.Property(payment => payment.Currency).HasMaxLength(8).IsRequired();
            entity.Property(payment => payment.FailureReason).HasMaxLength(1_000);
            entity.Property(payment => payment.RecordedByUserId).HasMaxLength(450);
            entity.HasIndex(payment => payment.OrderId);
            entity.HasIndex(payment => payment.ProviderCheckoutSessionId);
            entity.HasIndex(payment => payment.ProviderPaymentIntentId);
            entity.HasIndex(payment => payment.IdempotencyKey).IsUnique();
            entity.HasMany(payment => payment.Refunds)
                .WithOne(refund => refund.Payment)
                .HasForeignKey(refund => refund.PaymentId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(payment => payment.RefundRequests)
                .WithOne(request => request.Payment)
                .HasForeignKey(request => request.PaymentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PaymentRefund>(entity =>
        {
            entity.HasKey(refund => refund.Id);
            entity.Property(refund => refund.Provider).HasMaxLength(64).IsRequired();
            entity.Property(refund => refund.ProviderRefundId).HasMaxLength(255);
            entity.Property(refund => refund.ProviderPaymentIntentId).HasMaxLength(255);
            entity.Property(refund => refund.Currency).HasMaxLength(8).IsRequired();
            entity.Property(refund => refund.Reason).HasMaxLength(1_000);
            entity.Property(refund => refund.FailureReason).HasMaxLength(1_000);
            entity.Property(refund => refund.RequestedByUserId).HasMaxLength(450);
            entity.HasIndex(refund => refund.PaymentId);
            entity.HasIndex(refund => refund.OrderId);
            entity.HasIndex(refund => refund.ProviderRefundId);
            entity.HasIndex(refund => refund.ProviderPaymentIntentId);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_PaymentRefunds_AmountCents",
                "\"AmountCents\" > 0"));
        });

        builder.Entity<PaymentRefundRequest>(entity =>
        {
            entity.HasKey(request => request.Id);
            entity.Property(request => request.Currency).HasMaxLength(8).IsRequired();
            entity.Property(request => request.Reason).HasMaxLength(1_000);
            entity.Property(request => request.AdminNote).HasMaxLength(1_000);
            entity.Property(request => request.RequestedByUserId).HasMaxLength(450);
            entity.Property(request => request.RequesterName).HasMaxLength(200);
            entity.Property(request => request.RequesterEmail).HasMaxLength(256);
            entity.Property(request => request.ReviewedByUserId).HasMaxLength(450);
            entity.HasIndex(request => request.OrderId);
            entity.HasIndex(request => request.PaymentId);
            entity.HasIndex(request => request.PaymentRefundId);
            entity.HasIndex(request => request.RestaurantId);
            entity.HasIndex(request => request.Status);
            entity.HasOne(request => request.Order)
                .WithMany(order => order.RefundRequests)
                .HasForeignKey(request => request.OrderId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(request => request.PaymentRefund)
                .WithMany()
                .HasForeignKey(request => request.PaymentRefundId)
                .OnDelete(DeleteBehavior.SetNull);
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_PaymentRefundRequests_RequestedAmountCents",
                "\"RequestedAmountCents\" > 0"));
        });

        builder.Entity<AuditLog>(entity =>
        {
            entity.HasKey(log => log.Id);
            entity.Property(log => log.ActorUserId).HasMaxLength(450);
            entity.Property(log => log.ActorEmail).HasMaxLength(256);
            entity.Property(log => log.ActorRoles).HasMaxLength(300);
            entity.Property(log => log.ActorType).HasMaxLength(32);
            entity.Property(log => log.Source).HasMaxLength(64);
            entity.Property(log => log.CorrelationId).HasMaxLength(120);
            entity.Property(log => log.Action).HasMaxLength(120).IsRequired();
            entity.Property(log => log.EntityType).HasMaxLength(80).IsRequired();
            entity.Property(log => log.EntityId).HasMaxLength(120);
            entity.Property(log => log.Summary).HasMaxLength(700);
            entity.Property(log => log.IpAddress).HasMaxLength(64);
            entity.Property(log => log.UserAgent).HasMaxLength(512);
            entity.HasIndex(log => new { log.RestaurantId, log.CreatedAt });
            entity.HasIndex(log => log.ActorUserId);
            entity.HasIndex(log => log.Action);
            entity.HasIndex(log => log.CorrelationId);
            entity.HasIndex(log => new { log.EntityType, log.EntityId });
        });

        builder.Entity<OrderEventLog>(entity =>
        {
            entity.HasKey(log => log.Id);
            entity.Property(log => log.OrderNumber).HasMaxLength(80).IsRequired();
            entity.Property(log => log.ActorUserId).HasMaxLength(450);
            entity.Property(log => log.ActorDisplayName).HasMaxLength(256);
            entity.Property(log => log.ActorRoles).HasMaxLength(300);
            entity.Property(log => log.ActorType).HasMaxLength(32);
            entity.Property(log => log.Source).HasMaxLength(64);
            entity.Property(log => log.CorrelationId).HasMaxLength(120);
            entity.Property(log => log.EventType).HasMaxLength(120).IsRequired();
            entity.Property(log => log.Message).HasMaxLength(700).IsRequired();
            entity.HasIndex(log => new { log.RestaurantId, log.CreatedAt });
            entity.HasIndex(log => new { log.OrderId, log.CreatedAt });
            entity.HasIndex(log => log.EventType);
            entity.HasIndex(log => log.CorrelationId);
        });

        builder.Entity<PaymentEventLog>(entity =>
        {
            entity.HasKey(log => log.Id);
            entity.Property(log => log.OrderNumber).HasMaxLength(80);
            entity.Property(log => log.Provider).HasMaxLength(64).IsRequired();
            entity.Property(log => log.EventType).HasMaxLength(120).IsRequired();
            entity.Property(log => log.ProviderEventId).HasMaxLength(255);
            entity.Property(log => log.Status).HasMaxLength(80);
            entity.Property(log => log.Message).HasMaxLength(700).IsRequired();
            entity.Property(log => log.ActorUserId).HasMaxLength(450);
            entity.Property(log => log.ActorDisplayName).HasMaxLength(256);
            entity.Property(log => log.ActorRoles).HasMaxLength(300);
            entity.Property(log => log.ActorType).HasMaxLength(32);
            entity.Property(log => log.Source).HasMaxLength(64);
            entity.Property(log => log.CorrelationId).HasMaxLength(120);
            entity.HasIndex(log => new { log.RestaurantId, log.CreatedAt });
            entity.HasIndex(log => new { log.OrderId, log.CreatedAt });
            entity.HasIndex(log => new { log.PaymentId, log.CreatedAt });
            entity.HasIndex(log => log.PaymentRefundId);
            entity.HasIndex(log => log.EventType);
            entity.HasIndex(log => log.ProviderEventId);
            entity.HasIndex(log => log.CorrelationId);
        });

        builder.Entity<StripeWebhookEvent>(entity =>
        {
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventId).HasMaxLength(255).IsRequired();
            entity.Property(item => item.StripeAccountId).HasMaxLength(255);
            entity.Property(item => item.EventType).HasMaxLength(120).IsRequired();
            entity.HasIndex(item => item.EventId).IsUnique();
            entity.HasIndex(item => new { item.StripeAccountId, item.ProviderCreatedAt });
        });

    }

    private void EnsureReportLogsAreAppendOnly()
    {
        var invalidEntry = ChangeTracker
            .Entries()
            .FirstOrDefault(entry =>
                entry.Entity is AuditLog or OrderEventLog or PaymentEventLog &&
                entry.State is EntityState.Modified or EntityState.Deleted);

        if (invalidEntry is not null)
        {
            throw new InvalidOperationException("Report log entries are immutable and cannot be updated or deleted.");
        }
    }
}
