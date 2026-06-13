using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMenuOptionsAndOrderSnapshots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "Note",
                table: "OrderItems",
                newName: "ItemInstructions");

            migrationBuilder.AlterColumn<decimal>(
                name: "UnitPrice",
                table: "OrderItems",
                type: "numeric(10,2)",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric");

            migrationBuilder.AddColumn<string>(
                name: "AllergyInfo",
                table: "OrderItems",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "BasePriceSnapshot",
                table: "OrderItems",
                type: "numeric(10,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "MenuItemNameSnapshot",
                table: "OrderItems",
                type: "character varying(240)",
                maxLength: 240,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "MenuItemOptionGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    IsRequired = table.Column<bool>(type: "boolean", nullable: false),
                    MinSelections = table.Column<int>(type: "integer", nullable: false),
                    MaxSelections = table.Column<int>(type: "integer", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuItemOptionGroups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MenuItemOptionGroups_MenuItems_MenuItemId",
                        column: x => x.MenuItemId,
                        principalTable: "MenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrderItemOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemOptionId = table.Column<Guid>(type: "uuid", nullable: true),
                    GroupNameSnapshot = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OptionNameSnapshot = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PriceAdjustmentSnapshot = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderItemOptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OrderItemOptions_OrderItems_OrderItemId",
                        column: x => x.OrderItemId,
                        principalTable: "OrderItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MenuItemOptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PriceAdjustment = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    AdjustmentType = table.Column<int>(type: "integer", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    IsAvailable = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MenuItemOptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MenuItemOptions_MenuItemOptionGroups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "MenuItemOptionGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MenuItems_RestaurantId",
                table: "MenuItems",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemOptionGroups_MenuItemId",
                table: "MenuItemOptionGroups",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemOptionGroups_RestaurantId",
                table: "MenuItemOptionGroups",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemOptions_GroupId",
                table: "MenuItemOptions",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemOptions_MenuItemId",
                table: "MenuItemOptions",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_MenuItemOptions_RestaurantId",
                table: "MenuItemOptions",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_OrderItemOptions_OrderItemId",
                table: "OrderItemOptions",
                column: "OrderItemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MenuItemOptions");

            migrationBuilder.DropTable(
                name: "OrderItemOptions");

            migrationBuilder.DropTable(
                name: "MenuItemOptionGroups");

            migrationBuilder.DropIndex(
                name: "IX_MenuItems_RestaurantId",
                table: "MenuItems");

            migrationBuilder.DropColumn(
                name: "AllergyInfo",
                table: "OrderItems");

            migrationBuilder.DropColumn(
                name: "BasePriceSnapshot",
                table: "OrderItems");

            migrationBuilder.DropColumn(
                name: "MenuItemNameSnapshot",
                table: "OrderItems");

            migrationBuilder.RenameColumn(
                name: "ItemInstructions",
                table: "OrderItems",
                newName: "Note");

            migrationBuilder.AlterColumn<decimal>(
                name: "UnitPrice",
                table: "OrderItems",
                type: "numeric",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "numeric(10,2)");
        }
    }
}
