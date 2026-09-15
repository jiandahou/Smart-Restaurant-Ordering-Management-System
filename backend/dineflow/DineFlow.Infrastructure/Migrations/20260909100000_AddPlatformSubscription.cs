using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Room for a Stripe subscription, so the platform can charge a restaurant more than once.
///
/// <para>
/// The status is kept as the word Stripe used rather than mapped to an enum of our own. The rule
/// reads a handful of these as healthy and treats everything else — including a status this version
/// has never met — as behind, which warns rather than closes. An enum would turn a status Stripe
/// adds later into a parse failure, which is a worse answer than "warn somebody".
/// </para>
///
/// <para>
/// The customer id is stored because Checkout mints its own when it is not given one. Without it a
/// second attempt creates a second customer, and the billing portal then opens on a card the
/// restaurant is not being charged on.
/// </para>
///
/// <para>
/// Every column is nullable and every existing restaurant keeps a null in all of them, which the
/// billing rule reads as a restaurant on no subscription. Nothing changes for anyone.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260909100000_AddPlatformSubscription")]
public partial class AddPlatformSubscription : Migration
{
    private static readonly (string Name, int Length)[] TextColumns =
    [
        ("PlatformStripeCustomerId", 255),
        ("PlatformSubscriptionId", 255),
        ("PlatformSubscriptionStatus", 32),
        ("PlatformSubscriptionPriceId", 255),
        ("PlatformSubscriptionCheckoutSessionId", 255),
        ("PlatformSubscriptionCheckoutUrl", 2048),
        ("PlatformSubscriptionIdempotencyKey", 255),
    ];

    protected override void Up(MigrationBuilder migrationBuilder)
    {
        foreach (var (name, length) in TextColumns)
        {
            migrationBuilder.AddColumn<string>(
                name: name,
                table: "Restaurants",
                type: $"character varying({length})",
                maxLength: length,
                nullable: true);
        }

        migrationBuilder.AddColumn<DateTime>(
            name: "PlatformSubscriptionCurrentPeriodEndAt",
            table: "Restaurants",
            type: "timestamp with time zone",
            nullable: true);

        migrationBuilder.AddColumn<bool>(
            name: "PlatformSubscriptionCancelAtPeriodEnd",
            table: "Restaurants",
            type: "boolean",
            nullable: false,
            defaultValue: false);

        // Subscription webhooks arrive knowing a customer or a subscription, not a restaurant.
        migrationBuilder.CreateIndex(
            name: "IX_Restaurants_PlatformStripeCustomerId",
            table: "Restaurants",
            column: "PlatformStripeCustomerId");

        migrationBuilder.CreateIndex(
            name: "IX_Restaurants_PlatformSubscriptionId",
            table: "Restaurants",
            column: "PlatformSubscriptionId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_Restaurants_PlatformSubscriptionId", table: "Restaurants");
        migrationBuilder.DropIndex(name: "IX_Restaurants_PlatformStripeCustomerId", table: "Restaurants");

        migrationBuilder.DropColumn(name: "PlatformSubscriptionCancelAtPeriodEnd", table: "Restaurants");
        migrationBuilder.DropColumn(name: "PlatformSubscriptionCurrentPeriodEndAt", table: "Restaurants");

        foreach (var (name, _) in TextColumns)
        {
            migrationBuilder.DropColumn(name: name, table: "Restaurants");
        }
    }
}
