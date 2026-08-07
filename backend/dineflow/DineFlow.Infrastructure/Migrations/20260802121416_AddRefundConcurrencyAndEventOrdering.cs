using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRefundConcurrencyAndEventOrdering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastProviderEventCreatedAt",
                table: "PaymentRefunds",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_PaymentRefunds_OnePendingPerPayment",
                table: "PaymentRefunds",
                column: "PaymentId",
                unique: true,
                filter: "\"Status\" = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "UX_PaymentRefunds_OnePendingPerPayment",
                table: "PaymentRefunds");

            migrationBuilder.DropColumn(
                name: "LastProviderEventCreatedAt",
                table: "PaymentRefunds");
        }
    }
}
