using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260704100000_AddRestaurantSpecialOpeningDays")]
    public partial class AddRestaurantSpecialOpeningDays : Migration
    {
        private const string PreviousDefaultOpeningHoursJson =
            "[{\"dayOfWeek\":0,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":1,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":2,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":3,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":4,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":5,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"},{\"dayOfWeek\":6,\"isOpen\":true,\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]";

        private const string DefaultOpeningHoursJson =
            "[{\"dayOfWeek\":0,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "OpeningHoursJson",
                table: "Restaurants",
                type: "text",
                nullable: false,
                defaultValue: DefaultOpeningHoursJson,
                oldClrType: typeof(string),
                oldType: "text",
                oldDefaultValue: PreviousDefaultOpeningHoursJson);

            migrationBuilder.AddColumn<string>(
                name: "SpecialOpeningDaysJson",
                table: "Restaurants",
                type: "text",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SpecialOpeningDaysJson",
                table: "Restaurants");

            migrationBuilder.AlterColumn<string>(
                name: "OpeningHoursJson",
                table: "Restaurants",
                type: "text",
                nullable: false,
                defaultValue: PreviousDefaultOpeningHoursJson,
                oldClrType: typeof(string),
                oldType: "text",
                oldDefaultValue: DefaultOpeningHoursJson);
        }
    }
}
