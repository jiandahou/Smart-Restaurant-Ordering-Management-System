using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Lets a refund say which modifier it was for.
///
/// <para>
/// A refund could point at an order line and no finer, so a customer who wanted the extra truffle
/// back and the bread kept could only enter an amount against the whole line, and the record could
/// not say what the amount was for. The platform already prices modifiers and already counts their
/// stock; it could not refund one.
/// </para>
///
/// <para>
/// Nullable, and null keeps the meaning every existing row already has: this refund is for the line
/// as a whole. That is what makes this migration boring — no backfill, no reinterpretation, and the
/// existing accounting keeps working unchanged on historical data.
/// </para>
///
/// <para>
/// No foreign key, deliberately. <c>OrderItemOptions</c> rows belong to an order and are never
/// deleted while the order stands, but report evidence outlives the operational tables it refers to
/// — retention archives and deletes order data on its own schedule, and a refund record that a
/// cascade could remove, or that could block a deletion, is not evidence. The column is checked in
/// application code against the order actually loaded, which is where the modifier has to be found
/// anyway in order to price it.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260908030000_AddRefundItemModifierReference")]
public partial class AddRefundItemModifierReference : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<Guid>(
            name: "OrderItemOptionId",
            table: "PaymentRefundRequestItems",
            type: "uuid",
            nullable: true);

        migrationBuilder.AddColumn<Guid>(
            name: "OrderItemOptionId",
            table: "PaymentRefundItems",
            type: "uuid",
            nullable: true);

        // Reading a line's settled grain asks "are any of this line's refund allocations tagged with
        // a modifier", which is a scan of one order line's refunds and is answered from here.
        migrationBuilder.CreateIndex(
            name: "IX_PaymentRefundItems_OrderItemId_OrderItemOptionId",
            table: "PaymentRefundItems",
            columns: ["OrderItemId", "OrderItemOptionId"]);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_PaymentRefundItems_OrderItemId_OrderItemOptionId",
            table: "PaymentRefundItems");
        migrationBuilder.DropColumn(name: "OrderItemOptionId", table: "PaymentRefundItems");
        migrationBuilder.DropColumn(name: "OrderItemOptionId", table: "PaymentRefundRequestItems");
    }
}
