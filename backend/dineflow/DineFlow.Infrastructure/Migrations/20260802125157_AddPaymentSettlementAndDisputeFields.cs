using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentSettlementAndDisputeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DisputeReason",
                table: "Payments",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DisputeStatus",
                table: "Payments",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DisputedAt",
                table: "Payments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSyncedAt",
                table: "Payments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "NetAmountCents",
                table: "Payments",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProviderChargeId",
                table: "Payments",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "StripeFeeAmountCents",
                table: "Payments",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ProviderChargeId",
                table: "Payments",
                column: "ProviderChargeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Payments_ProviderChargeId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DisputeReason",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DisputeStatus",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DisputedAt",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "LastSyncedAt",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "NetAmountCents",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "ProviderChargeId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "StripeFeeAmountCents",
                table: "Payments");
        }
    }
}
