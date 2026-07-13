using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFrontCounterSessions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "PickupDate",
                table: "Orders",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PickupNumber",
                table: "Orders",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TableSessionId",
                table: "Orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "TableSessionId",
                table: "Carts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TableSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TableId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    OpenedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TableSessions", x => x.Id);
                    table.CheckConstraint("CK_TableSessions_ClosedAt", "\"ClosedAt\" IS NULL OR \"ClosedAt\" >= \"OpenedAt\"");
                    table.CheckConstraint("CK_TableSessions_Status", "\"Status\" IN (0, 1)");
                    table.ForeignKey(
                        name: "FK_TableSessions_RestaurantTables_TableId",
                        column: x => x.TableId,
                        principalTable: "RestaurantTables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TableSessions_Restaurants_RestaurantId",
                        column: x => x.RestaurantId,
                        principalTable: "Restaurants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_RestaurantId_PickupDate_PickupNumber",
                table: "Orders",
                columns: new[] { "RestaurantId", "PickupDate", "PickupNumber" },
                unique: true,
                filter: "\"RestaurantId\" IS NOT NULL AND \"PickupDate\" IS NOT NULL AND \"PickupNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_TableSessionId",
                table: "Orders",
                column: "TableSessionId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Orders_PickupNumber",
                table: "Orders",
                sql: "\"PickupNumber\" IS NULL OR \"PickupNumber\" > 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Orders_PickupPair",
                table: "Orders",
                sql: "(\"PickupDate\" IS NULL AND \"PickupNumber\" IS NULL) OR (\"PickupDate\" IS NOT NULL AND \"PickupNumber\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_TableSessionId",
                table: "Carts",
                column: "TableSessionId");

            migrationBuilder.CreateIndex(
                name: "IX_TableSessions_RestaurantId",
                table: "TableSessions",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_TableSessions_Status",
                table: "TableSessions",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TableSessions_TableId",
                table: "TableSessions",
                column: "TableId");

            migrationBuilder.CreateIndex(
                name: "IX_TableSessions_TableId_Open",
                table: "TableSessions",
                columns: new[] { "TableId", "Status" },
                unique: true,
                filter: "\"Status\" = 0");

            migrationBuilder.AddForeignKey(
                name: "FK_Carts_TableSessions_TableSessionId",
                table: "Carts",
                column: "TableSessionId",
                principalTable: "TableSessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Orders_TableSessions_TableSessionId",
                table: "Orders",
                column: "TableSessionId",
                principalTable: "TableSessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Carts_TableSessions_TableSessionId",
                table: "Carts");

            migrationBuilder.DropForeignKey(
                name: "FK_Orders_TableSessions_TableSessionId",
                table: "Orders");

            migrationBuilder.DropTable(
                name: "TableSessions");

            migrationBuilder.DropIndex(
                name: "IX_Orders_RestaurantId_PickupDate_PickupNumber",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Orders_TableSessionId",
                table: "Orders");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Orders_PickupNumber",
                table: "Orders");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Orders_PickupPair",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Carts_TableSessionId",
                table: "Carts");

            migrationBuilder.DropColumn(
                name: "PickupDate",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "PickupNumber",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "TableSessionId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "TableSessionId",
                table: "Carts");
        }
    }
}
