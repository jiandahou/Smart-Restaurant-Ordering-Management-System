using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Freezes the dish's allergen declaration onto the order line, as its name and price already were.
///
/// <para>
/// An order recorded which version of the allergen <em>notice</em> the customer acknowledged, but
/// never the declarations themselves — those were read live from the menu. The moment a restaurant
/// corrected a dish, every past order began describing the corrected version, and the record of
/// what a customer was actually shown and accepted was gone. That record is the one that matters
/// when somebody reacts to a meal and asks what they were told.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811110000_AddOrderItemAllergenSnapshots")]
public partial class AddOrderItemAllergenSnapshots : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Existing rows stay null. Backfilling from today's menu is exactly the mistake this fixes:
        // it would put current wording into orders placed before it, which is a worse record than
        // an honest blank.
        migrationBuilder.AddColumn<string>(
            name: "AllergensSnapshot",
            table: "OrderItems",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "MayContainAllergensSnapshot",
            table: "OrderItems",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "CrossContactStatementSnapshot",
            table: "OrderItems",
            type: "character varying(1000)",
            maxLength: 1000,
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "AllergensSnapshot", table: "OrderItems");
        migrationBuilder.DropColumn(name: "MayContainAllergensSnapshot", table: "OrderItems");
        migrationBuilder.DropColumn(name: "CrossContactStatementSnapshot", table: "OrderItems");
    }
}
