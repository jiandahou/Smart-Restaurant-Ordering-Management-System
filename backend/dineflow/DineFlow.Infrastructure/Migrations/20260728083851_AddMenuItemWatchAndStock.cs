using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuItemWatchAndStock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsWatched",
                table: "MenuItems",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "StockQuantity",
                table: "MenuItems",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_MenuItems_RestaurantId_IsWatched",
                table: "MenuItems",
                columns: new[] { "RestaurantId", "IsWatched" },
                filter: "\"IsWatched\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MenuItems_StockQuantity",
                table: "MenuItems",
                sql: "\"StockQuantity\" IS NULL OR \"StockQuantity\" >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MenuItems_RestaurantId_IsWatched",
                table: "MenuItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MenuItems_StockQuantity",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "IsWatched",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "StockQuantity",
                table: "MenuItems");
        }
    }
}
