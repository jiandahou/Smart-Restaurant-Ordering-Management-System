using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuItemCustomerMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Calories",
                table: "MenuItems",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPopular",
                table: "MenuItems",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsRecommended",
                table: "MenuItems",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ServingSize",
                table: "MenuItems",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SpiceLevel",
                table: "MenuItems",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Calories",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "IsPopular",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "IsRecommended",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "ServingSize",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "SpiceLevel",
                table: "MenuItems");
        }
    }
}
