using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRestaurantCountryCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CountryCode",
                table: "Restaurants",
                type: "character varying(2)",
                maxLength: 2,
                nullable: false,
                defaultValue: "AU");

            migrationBuilder.Sql(
                """
                UPDATE "Restaurants"
                SET "CountryCode" = CASE
                    WHEN upper("Currency") = 'NPR' OR "Timezone" = 'Asia/Kathmandu' THEN 'NP'
                    WHEN upper("Currency") = 'INR' OR "Timezone" = 'Asia/Kolkata' THEN 'IN'
                    WHEN upper("Currency") = 'NZD' OR "Timezone" = 'Pacific/Auckland' THEN 'NZ'
                    WHEN upper("Currency") = 'USD' OR "Timezone" LIKE 'America/%' THEN 'US'
                    WHEN upper("Currency") = 'GBP' OR "Timezone" LIKE 'Europe/London' THEN 'GB'
                    WHEN upper("Currency") = 'CAD' OR "Timezone" LIKE 'America/Toronto' THEN 'CA'
                    ELSE 'AU'
                END
                WHERE "CountryCode" = 'AU';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CountryCode",
                table: "Restaurants");
        }
    }
}
