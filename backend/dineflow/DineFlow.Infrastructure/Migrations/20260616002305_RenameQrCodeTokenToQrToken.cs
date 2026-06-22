using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RenameQrCodeTokenToQrToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "QrCodeToken",
                table: "RestaurantTables",
                newName: "QrToken");

            migrationBuilder.RenameIndex(
                name: "IX_RestaurantTables_QrCodeToken",
                table: "RestaurantTables",
                newName: "IX_RestaurantTables_QrToken");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "QrToken",
                table: "RestaurantTables",
                newName: "QrCodeToken");

            migrationBuilder.RenameIndex(
                name: "IX_RestaurantTables_QrToken",
                table: "RestaurantTables",
                newName: "IX_RestaurantTables_QrCodeToken");
        }
    }
}
