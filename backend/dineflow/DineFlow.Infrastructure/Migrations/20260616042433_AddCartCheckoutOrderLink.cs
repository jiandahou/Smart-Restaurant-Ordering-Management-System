using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCartCheckoutOrderLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "OrderNumber",
                table: "Orders",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.Sql("""
                ALTER TABLE "Orders"
                ALTER COLUMN "CustomerId" TYPE character varying(450)
                USING "CustomerId"::text;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Note",
                table: "OrderItems",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ItemNameSnapshot",
                table: "OrderItems",
                type: "character varying(220)",
                maxLength: 220,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql("""
                UPDATE "OrderItems" AS order_item
                SET "ItemNameSnapshot" = COALESCE(menu_item."Name", 'Unavailable item')
                FROM "MenuItems" AS menu_item
                WHERE order_item."MenuItemId" = menu_item."Id"
                    AND order_item."ItemNameSnapshot" = '';
                """);

            migrationBuilder.AddColumn<Guid>(
                name: "OrderId",
                table: "Carts",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_OrderNumber",
                table: "Orders",
                column: "OrderNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Carts_OrderId",
                table: "Carts",
                column: "OrderId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Carts_Orders_OrderId",
                table: "Carts",
                column: "OrderId",
                principalTable: "Orders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Carts_Orders_OrderId",
                table: "Carts");

            migrationBuilder.DropIndex(
                name: "IX_Orders_OrderNumber",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Carts_OrderId",
                table: "Carts");

            migrationBuilder.DropColumn(
                name: "ItemNameSnapshot",
                table: "OrderItems");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "Carts");

            migrationBuilder.AlterColumn<string>(
                name: "OrderNumber",
                table: "Orders",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.Sql("""
                ALTER TABLE "Orders"
                ALTER COLUMN "CustomerId" TYPE uuid
                USING NULLIF("CustomerId", '')::uuid;
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Note",
                table: "OrderItems",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(2000)",
                oldMaxLength: 2000,
                oldNullable: true);
        }
    }
}
