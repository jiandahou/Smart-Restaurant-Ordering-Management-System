using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuItemOptionStock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Only this column. Everything else the scaffolder wanted to add is already in the
            // database — it came from migrations whose model snapshot was never updated, so EF was
            // comparing the current model against one nine migrations old. The regenerated snapshot
            // that ships with this migration is what puts that right.
            migrationBuilder.AddColumn<int>(
                name: "StockQuantity",
                table: "MenuItemOptions",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StockQuantity",
                table: "MenuItemOptions");
        }
    }
}
