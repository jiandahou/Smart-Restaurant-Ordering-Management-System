using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddStripeConnectAndPaymentReliability : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "OneTimePlatformFeeCents",
                table: "Restaurants",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "OneTimePlatformFeeCheckoutSessionId",
                table: "Restaurants",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OneTimePlatformFeeCheckoutUrl",
                table: "Restaurants",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OneTimePlatformFeeIdempotencyKey",
                table: "Restaurants",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OneTimePlatformFeePaidAt",
                table: "Restaurants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OneTimePlatformFeePaymentIntentId",
                table: "Restaurants",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OneTimePlatformFeeStatus",
                table: "Restaurants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "OrderPlatformFeeBps",
                table: "Restaurants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "StripeAccountId",
                table: "Restaurants",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "StripeAccountUpdatedAt",
                table: "Restaurants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "StripeChargesEnabled",
                table: "Restaurants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "StripeConnectedAt",
                table: "Restaurants",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "StripeDetailsSubmitted",
                table: "Restaurants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "StripePayoutsEnabled",
                table: "Restaurants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "StripeRequirementsDueJson",
                table: "Restaurants",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "CheckoutUrl",
                table: "Payments",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "Payments",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastProviderEventCreatedAt",
                table: "Payments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "PlatformFeeAmountCents",
                table: "Payments",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "StripeAccountId",
                table: "Payments",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "StripeWebhookEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    StripeAccountId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    EventType = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ProviderCreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StripeWebhookEvents", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Restaurants_StripeAccountId",
                table: "Restaurants",
                column: "StripeAccountId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Restaurants_OneTimePlatformFeeCents",
                table: "Restaurants",
                sql: "\"OneTimePlatformFeeCents\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Restaurants_OneTimePlatformFeeStatus",
                table: "Restaurants",
                sql: "\"OneTimePlatformFeeStatus\" IN (0, 1, 2, 3)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Restaurants_OrderPlatformFeeBps",
                table: "Restaurants",
                sql: "\"OrderPlatformFeeBps\" >= 0 AND \"OrderPlatformFeeBps\" <= 10000");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_IdempotencyKey",
                table: "Payments",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StripeWebhookEvents_EventId",
                table: "StripeWebhookEvents",
                column: "EventId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_StripeWebhookEvents_StripeAccountId_ProviderCreatedAt",
                table: "StripeWebhookEvents",
                columns: new[] { "StripeAccountId", "ProviderCreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StripeWebhookEvents");

            migrationBuilder.DropIndex(
                name: "IX_Restaurants_StripeAccountId",
                table: "Restaurants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Restaurants_OneTimePlatformFeeCents",
                table: "Restaurants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Restaurants_OneTimePlatformFeeStatus",
                table: "Restaurants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Restaurants_OrderPlatformFeeBps",
                table: "Restaurants");

            migrationBuilder.DropIndex(
                name: "IX_Payments_IdempotencyKey",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeeCents",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeeCheckoutSessionId",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeeCheckoutUrl",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeeIdempotencyKey",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeePaidAt",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeePaymentIntentId",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OneTimePlatformFeeStatus",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OrderPlatformFeeBps",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeAccountId",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeAccountUpdatedAt",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeChargesEnabled",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeConnectedAt",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeDetailsSubmitted",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripePayoutsEnabled",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "StripeRequirementsDueJson",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "CheckoutUrl",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "LastProviderEventCreatedAt",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "PlatformFeeAmountCents",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "StripeAccountId",
                table: "Payments");
        }
    }
}
