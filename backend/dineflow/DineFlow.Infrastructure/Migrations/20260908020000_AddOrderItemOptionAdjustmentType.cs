using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Records what an option did to a line's price, alongside how much it did it by.
///
/// <para>
/// The amount was snapshotted from the start and its meaning was not. The same stored 3.00 is a
/// surcharge under Add, a discount under Remove, and the entire price of the line under Replace,
/// which discards the base and every option before it. Which one applied could only be recovered by
/// reading the live menu row — and that is not a record: options get archived, which is why
/// <c>MenuItemOptionId</c> is nullable, and a restaurant can change an option's type whenever it
/// likes. Either one makes a past order's price unexplainable, and no receipt reprinted afterwards
/// can be shown to be the one the customer agreed to.
/// </para>
///
/// <para>
/// The backfill claims only what the menu can still prove. Where the option row survives, its
/// current type is copied: correct for every option whose type has not been edited, and the best
/// evidence that exists for the rest. Where it does not survive, the column stays null, meaning the
/// type is unknown rather than assumed — <c>Add</c> is the common case and would be right most of
/// the time, and a price that is right most of the time is worse than one that admits it does not
/// know.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260908020000_AddOrderItemOptionAdjustmentType")]
public partial class AddOrderItemOptionAdjustmentType : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "AdjustmentTypeSnapshot",
            table: "OrderItemOptions",
            type: "integer",
            nullable: true);

        migrationBuilder.Sql("""
            UPDATE "OrderItemOptions" o
            SET "AdjustmentTypeSnapshot" = m."AdjustmentType"
            FROM "MenuItemOptions" m
            WHERE m."Id" = o."MenuItemOptionId";
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "AdjustmentTypeSnapshot", table: "OrderItemOptions");
    }
}
