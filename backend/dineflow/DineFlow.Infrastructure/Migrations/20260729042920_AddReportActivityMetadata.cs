using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReportActivityMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ActorType",
                table: "PaymentEventLogs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CorrelationId",
                table: "PaymentEventLogs",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "PaymentEventLogs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ActorType",
                table: "OrderEventLogs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CorrelationId",
                table: "OrderEventLogs",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "OrderEventLogs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ActorType",
                table: "AuditLogs",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CorrelationId",
                table: "AuditLogs",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "AuditLogs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentEventLogs_CorrelationId",
                table: "PaymentEventLogs",
                column: "CorrelationId");

            migrationBuilder.CreateIndex(
                name: "IX_OrderEventLogs_CorrelationId",
                table: "OrderEventLogs",
                column: "CorrelationId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_CorrelationId",
                table: "AuditLogs",
                column: "CorrelationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PaymentEventLogs_CorrelationId",
                table: "PaymentEventLogs");

            migrationBuilder.DropIndex(
                name: "IX_OrderEventLogs_CorrelationId",
                table: "OrderEventLogs");

            migrationBuilder.DropIndex(
                name: "IX_AuditLogs_CorrelationId",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "ActorType",
                table: "PaymentEventLogs");

            migrationBuilder.DropColumn(
                name: "CorrelationId",
                table: "PaymentEventLogs");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "PaymentEventLogs");

            migrationBuilder.DropColumn(
                name: "ActorType",
                table: "OrderEventLogs");

            migrationBuilder.DropColumn(
                name: "CorrelationId",
                table: "OrderEventLogs");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "OrderEventLogs");

            migrationBuilder.DropColumn(
                name: "ActorType",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "CorrelationId",
                table: "AuditLogs");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "AuditLogs");
        }
    }
}
