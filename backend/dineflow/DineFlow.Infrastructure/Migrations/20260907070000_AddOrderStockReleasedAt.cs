using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Records whether an order is still holding the stock it reserved at checkout.
///
/// <para>
/// It used to be inferred from status, and the inference was false. Three paths close an order and
/// only two of them gave the portions back: the customer cancelling, and the sweeper that expires
/// unpaid orders. Staff rejecting an order at the counter — the path used most — released nothing,
/// and the sweeper could not catch it afterwards because the sweeper only looks at Pending orders.
/// Every order staff have ever rejected is still holding its portions.
/// </para>
///
/// <para>
/// So Cancelled and Rejected rows are of two kinds with nothing to distinguish them, and the
/// difference matters the moment one is reopened: re-reserving stock that was never given back
/// deducts it twice. The column ends the guessing, and makes the leaked orders a query rather than
/// a suspicion.
/// </para>
///
/// <para>
/// The backfill claims only what the history proves. A closed order whose status history records a
/// customer cancellation or an automatic expiry did release its stock, and is stamped accordingly.
/// Everything else is left null — still holding — which for orders closed before this migration is
/// both the truthful answer for staff-rejected ones and, for anything older or seeded whose
/// reservation was never real, the answer that changes no existing behaviour: a null never
/// re-reserves on reopen, which is exactly what happened before.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260907070000_AddOrderStockReleasedAt")]
public partial class AddOrderStockReleasedAt : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<DateTime>(
            name: "StockReleasedAt",
            table: "Orders",
            type: "timestamp with time zone",
            nullable: true);

        // Only the two paths that actually released. The timestamp is the release itself, taken
        // from the history row that recorded it rather than from the order's UpdatedAt, which any
        // later edit would have moved.
        migrationBuilder.Sql("""
            UPDATE "Orders" o
            SET "StockReleasedAt" = h."CreatedAt"
            FROM (
                SELECT DISTINCT ON ("OrderId") "OrderId", "CreatedAt"
                FROM "OrderStatusHistories"
                WHERE "Action" IN ('CustomerCancel', 'AutoExpireUnpaid')
                ORDER BY "OrderId", "CreatedAt" DESC
            ) h
            WHERE h."OrderId" = o."Id"
              AND o."Status" IN (5, 6);
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "StockReleasedAt", table: "Orders");
    }
}
