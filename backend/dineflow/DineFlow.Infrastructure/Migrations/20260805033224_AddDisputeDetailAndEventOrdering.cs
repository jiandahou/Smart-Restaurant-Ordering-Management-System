using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDisputeDetailAndEventOrdering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "DisputeAmountCents",
                table: "Payments",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DisputeEvidenceDueBy",
                table: "Payments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DisputeId",
                table: "Payments",
                type: "character varying(255)",
                maxLength: 255,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastDisputeEventCreatedAt",
                table: "Payments",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DisputeAmountCents",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DisputeEvidenceDueBy",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DisputeId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "LastDisputeEventCreatedAt",
                table: "Payments");
        }
    }
}
