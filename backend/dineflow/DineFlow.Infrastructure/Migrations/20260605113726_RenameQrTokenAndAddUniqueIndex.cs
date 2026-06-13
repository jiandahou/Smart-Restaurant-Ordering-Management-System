using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RenameQrTokenAndAddUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "QrToken",
                table: "RestaurantTables",
                newName: "QrCodeToken");

            migrationBuilder.CreateIndex(
                name: "IX_RestaurantTables_QrCodeToken",
                table: "RestaurantTables",
                column: "QrCodeToken",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RestaurantTables_RestaurantId",
                table: "RestaurantTables",
                column: "RestaurantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RestaurantTables_QrCodeToken",
                table: "RestaurantTables");

            migrationBuilder.DropIndex(
                name: "IX_RestaurantTables_RestaurantId",
                table: "RestaurantTables");

            migrationBuilder.RenameColumn(
                name: "QrCodeToken",
                table: "RestaurantTables",
                newName: "QrToken");
        }
    }
}
