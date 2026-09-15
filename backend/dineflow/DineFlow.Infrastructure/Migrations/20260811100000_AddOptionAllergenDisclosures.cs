using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Lets a menu option carry its own allergen declaration, and freezes it onto the order.
///
/// <para>
/// A dish's declaration describes the dish as listed. Options — "add satay sauce", "swap to the
/// brioche bun" — had nowhere to record what they themselves contain, so choosing one changed what
/// was on the plate while the panel the customer reads before ordering went on describing the dish
/// without it. There was no way for a restaurant to disclose it and no way for a customer to see it.
/// </para>
///
/// <para>
/// The order columns are snapshots, alongside the name and price already frozen there: a receipt
/// has to show the wording the customer actually read, even after the menu is corrected.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811100000_AddOptionAllergenDisclosures")]
public partial class AddOptionAllergenDisclosures : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Null everywhere to begin with, which reads as "not declared" — the same thing the dish's
        // own empty fields mean. Nothing here invents a declaration on a restaurant's behalf.
        migrationBuilder.AddColumn<string>(
            name: "Allergens",
            table: "MenuItemOptions",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "MayContainAllergens",
            table: "MenuItemOptions",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "CrossContactStatement",
            table: "MenuItemOptions",
            type: "character varying(1000)",
            maxLength: 1000,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "AllergensSnapshot",
            table: "OrderItemOptions",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "MayContainAllergensSnapshot",
            table: "OrderItemOptions",
            type: "character varying(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "CrossContactStatementSnapshot",
            table: "OrderItemOptions",
            type: "character varying(1000)",
            maxLength: 1000,
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "Allergens", table: "MenuItemOptions");
        migrationBuilder.DropColumn(name: "MayContainAllergens", table: "MenuItemOptions");
        migrationBuilder.DropColumn(name: "CrossContactStatement", table: "MenuItemOptions");
        migrationBuilder.DropColumn(name: "AllergensSnapshot", table: "OrderItemOptions");
        migrationBuilder.DropColumn(name: "MayContainAllergensSnapshot", table: "OrderItemOptions");
        migrationBuilder.DropColumn(name: "CrossContactStatementSnapshot", table: "OrderItemOptions");
    }
}
