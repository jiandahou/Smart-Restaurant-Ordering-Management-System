using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Stops <c>MenuItemOptions.AdjustmentType</c> holding a value no pricing rule recognises.
///
/// <para>
/// The enum is persisted as a plain integer and the API cast the request straight to it, so a
/// request naming type 99 was stored. The two sides then disagreed about what it meant: the
/// customer's browser had no case for it and fell through to "add", showing +A$1.00 on a A$12.34
/// item; the server's calculator had a default that left the price alone and charged A$12.34. One
/// row, one customer, two prices.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811090000_ConstrainOptionAdjustmentType")]
public partial class ConstrainOptionAdjustmentType : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Existing rows have to be resolved before the constraint can go on, and the intent behind
        // an unrecognised value is not recoverable. "Add" is the reading the menu already showed
        // the customer, and the one the restaurant almost certainly meant — every option in the
        // seeded data and all but a handful in practice are Add. Making it explicit brings the
        // charge into line with the price that was on display rather than inventing a third answer.
        migrationBuilder.Sql("""
            UPDATE "MenuItemOptions"
            SET "AdjustmentType" = 0
            WHERE "AdjustmentType" NOT IN (0, 1, 2);
            """);

        migrationBuilder.Sql("""
            ALTER TABLE "MenuItemOptions"
            ADD CONSTRAINT "CK_MenuItemOptions_AdjustmentType"
            CHECK ("AdjustmentType" IN (0, 1, 2));
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // The coerced rows are not restored: their original values named no pricing rule, so there
        // is nothing to go back to.
        migrationBuilder.Sql("""
            ALTER TABLE "MenuItemOptions"
            DROP CONSTRAINT IF EXISTS "CK_MenuItemOptions_AdjustmentType";
            """);
    }
}
