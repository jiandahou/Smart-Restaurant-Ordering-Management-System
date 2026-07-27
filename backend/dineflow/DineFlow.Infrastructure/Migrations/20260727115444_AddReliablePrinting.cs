using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReliablePrinting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TicketRevision",
                table: "Orders",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "PrintStations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    StationKey = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    AutoPrintEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    AutoPrintEnabledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LeaseOwner = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    LeaseExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    QzStatus = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    PrinterStatus = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    PrinterName = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    ConnectionType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    QzVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    LastError = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    LastSuccessfulPrintAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrintStations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PrintJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TicketRevision = table.Column<int>(type: "integer", nullable: false),
                    DeduplicationKey = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    Trigger = table.Column<int>(type: "integer", nullable: false),
                    State = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    StationId = table.Column<Guid>(type: "uuid", nullable: true),
                    LeaseToken = table.Column<Guid>(type: "uuid", nullable: true),
                    LeaseExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    LastStatusDetail = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClaimedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrintJobs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PrintJobs_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PrintJobs_PrintStations_StationId",
                        column: x => x.StationId,
                        principalTable: "PrintStations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PrintJobs_DeduplicationKey",
                table: "PrintJobs",
                column: "DeduplicationKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PrintJobs_LeaseExpiresAt",
                table: "PrintJobs",
                column: "LeaseExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_PrintJobs_OrderId_TicketRevision",
                table: "PrintJobs",
                columns: new[] { "OrderId", "TicketRevision" });

            migrationBuilder.CreateIndex(
                name: "IX_PrintJobs_RestaurantId_State_NextAttemptAt",
                table: "PrintJobs",
                columns: new[] { "RestaurantId", "State", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PrintJobs_StationId",
                table: "PrintJobs",
                column: "StationId");

            migrationBuilder.CreateIndex(
                name: "IX_PrintStations_LastSeenAt",
                table: "PrintStations",
                column: "LastSeenAt");

            migrationBuilder.CreateIndex(
                name: "IX_PrintStations_RestaurantId_StationKey",
                table: "PrintStations",
                columns: new[] { "RestaurantId", "StationKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PrintJobs");

            migrationBuilder.DropTable(
                name: "PrintStations");

            migrationBuilder.DropColumn(
                name: "TicketRevision",
                table: "Orders");
        }
    }
}
