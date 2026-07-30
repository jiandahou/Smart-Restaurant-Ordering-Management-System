using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRestaurantPickupCounters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RestaurantPickupCounters",
                columns: table => new
                {
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    PickupDate = table.Column<DateOnly>(type: "date", nullable: false),
                    LastNumber = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RestaurantPickupCounters", x => new { x.RestaurantId, x.PickupDate });
                    table.CheckConstraint("CK_RestaurantPickupCounters_LastNumber", "\"LastNumber\" > 0");
                });

            // Seed the counters from the numbers already handed out, otherwise the first
            // order after this migration would restart at 1 and collide with an existing row.
            migrationBuilder.Sql("""
                INSERT INTO "RestaurantPickupCounters" ("RestaurantId", "PickupDate", "LastNumber")
                SELECT "RestaurantId", "PickupDate", MAX("PickupNumber")
                FROM "Orders"
                WHERE "RestaurantId" IS NOT NULL
                  AND "PickupDate" IS NOT NULL
                  AND "PickupNumber" IS NOT NULL
                GROUP BY "RestaurantId", "PickupDate";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RestaurantPickupCounters");
        }
    }
}
