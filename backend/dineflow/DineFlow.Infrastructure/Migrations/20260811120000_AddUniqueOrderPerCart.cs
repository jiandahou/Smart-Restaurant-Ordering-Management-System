using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Makes one cart able to produce only one order, in the database rather than only in the code.
///
/// <para>
/// Checkout took a <c>FOR UPDATE</c> lock on the cart, so a second request did wait — but the row
/// it read back was discarded: authorization had already loaded the cart, and EF hands a tracked
/// instance back unchanged. The loser of the race woke up holding a snapshot that still read
/// "active, no order" and placed a second one. Two order numbers, two kitchen tickets, one cart
/// pointing at whichever committed last, and the other order belonging to nobody.
/// </para>
///
/// <para>
/// The application fix is to reload after taking the lock. This is the floor beneath it: even if
/// that is undone, or a future path forgets to lock at all, the second insert cannot succeed.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811120000_AddUniqueOrderPerCart")]
public partial class AddUniqueOrderPerCart : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<Guid>(
            name: "CartId",
            table: "Orders",
            type: "uuid",
            nullable: true);

        // Backfill from the side that already recorded the link. Only the winner of a past race is
        // recoverable this way, which is correct: the duplicate it left behind was never claimed by
        // any cart, and inventing a claim for it now would be a guess dressed as a record.
        migrationBuilder.Sql("""
            UPDATE "Orders" o
            SET "CartId" = c."Id"
            FROM "Carts" c
            WHERE c."OrderId" = o."Id";
            """);

        // Filtered: counter and admin orders have no cart, and every one of them would otherwise
        // collide with the others on NULL.
        migrationBuilder.CreateIndex(
            name: "IX_Orders_CartId_Unique",
            table: "Orders",
            column: "CartId",
            unique: true,
            filter: "\"CartId\" IS NOT NULL");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_Orders_CartId_Unique", table: "Orders");
        migrationBuilder.DropColumn(name: "CartId", table: "Orders");
    }
}
