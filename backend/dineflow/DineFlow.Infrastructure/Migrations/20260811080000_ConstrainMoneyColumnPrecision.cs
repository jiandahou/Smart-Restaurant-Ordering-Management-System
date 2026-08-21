using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Gives the last two unconstrained money columns the precision every other one already had.
///
/// <para>
/// <c>MenuItems.Price</c> and <c>Orders.TotalAmount</c> were plain <c>numeric</c>, which in
/// PostgreSQL stores whatever it is handed. Their neighbours — <c>OrderItems.UnitPrice</c>,
/// <c>OrderItems.BasePriceSnapshot</c>, <c>MenuItemOptions.PriceAdjustment</c> — are all
/// <c>numeric(10,2)</c>. A price of 9.999 therefore survived intact in one column while the order
/// line copied from it rounded to 10.00, and three of those lines produced an order total of
/// 29.997 that no payment could ever match.
/// </para>
///
/// <para>
/// The API now refuses a price finer than the currency's minor unit, so this is the floor beneath
/// that rule rather than the rule itself.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811080000_ConstrainMoneyColumnPrecision")]
public partial class ConstrainMoneyColumnPrecision : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Existing rows are rounded to the nearest cent by the type change itself. Any row this
        // moves was already being charged at the rounded figure, so this aligns the record with the
        // money that actually moved rather than changing anyone's price.
        migrationBuilder.AlterColumn<decimal>(
            name: "Price",
            table: "MenuItems",
            type: "numeric(10,2)",
            nullable: false,
            oldClrType: typeof(decimal),
            oldType: "numeric");

        migrationBuilder.AlterColumn<decimal>(
            name: "TotalAmount",
            table: "Orders",
            type: "numeric(10,2)",
            nullable: false,
            oldClrType: typeof(decimal),
            oldType: "numeric");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AlterColumn<decimal>(
            name: "Price",
            table: "MenuItems",
            type: "numeric",
            nullable: false,
            oldClrType: typeof(decimal),
            oldType: "numeric(10,2)");

        migrationBuilder.AlterColumn<decimal>(
            name: "TotalAmount",
            table: "Orders",
            type: "numeric",
            nullable: false,
            oldClrType: typeof(decimal),
            oldType: "numeric(10,2)");
    }
}
