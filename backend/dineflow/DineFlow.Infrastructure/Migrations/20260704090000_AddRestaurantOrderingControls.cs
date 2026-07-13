using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260704090000_AddRestaurantOrderingControls")]
    public partial class AddRestaurantOrderingControls : Migration
    {
        private const string DefaultOpeningHoursJson =
            "[{\"dayOfWeek\":0,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":1,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":2,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":3,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":4,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":5,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":6,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AcceptingOrders",
                table: "Restaurants",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "OpeningHoursJson",
                table: "Restaurants",
                type: "text",
                nullable: false,
                defaultValue: DefaultOpeningHoursJson);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AcceptingOrders",
                table: "Restaurants");

            migrationBuilder.DropColumn(
                name: "OpeningHoursJson",
                table: "Restaurants");
        }
    }
}
