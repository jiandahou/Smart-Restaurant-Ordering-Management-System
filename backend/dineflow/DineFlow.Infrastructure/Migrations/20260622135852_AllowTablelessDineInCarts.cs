using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AllowTablelessDineInCarts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Carts_TableOrderType",
                table: "Carts");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Carts_TableOrderType",
                table: "Carts",
                sql: "\"TableId\" IS NULL OR \"OrderType\" = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Carts_TableOrderType",
                table: "Carts");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Carts_TableOrderType",
                table: "Carts",
                sql: "(\"OrderType\" = 0 AND \"TableId\" IS NOT NULL) OR (\"OrderType\" <> 0 AND \"TableId\" IS NULL)");
        }
    }
}
