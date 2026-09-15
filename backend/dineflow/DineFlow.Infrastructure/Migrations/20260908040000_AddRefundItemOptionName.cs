using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Lets a refund say which extra it was for without reaching back into the order.
///
/// <para>
/// The dish's name has always been snapshotted onto the refund rather than joined from the order,
/// and the extra's name belongs there for the same reason, sharpened by this record's own job.
/// Retention archives and deletes order data on its own schedule; a refund that had to read an
/// order to describe itself would eventually stop being able to. It is also the name the customer
/// was shown at the time, which is the one a refund record has to repeat — an option renamed on the
/// menu since must not silently rewrite what a past refund says it returned.
/// </para>
///
/// <para>
/// Backfilled from the order rows while they are still there. Whole-line refunds keep null, which
/// is what they already mean.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260908040000_AddRefundItemOptionName")]
public partial class AddRefundItemOptionName : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        foreach (var table in new[] { "PaymentRefundItems", "PaymentRefundRequestItems" })
        {
            migrationBuilder.AddColumn<string>(
                name: "OptionNameSnapshot",
                table: table,
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.Sql($"""
                UPDATE "{table}" r
                SET "OptionNameSnapshot" = o."OptionNameSnapshot"
                FROM "OrderItemOptions" o
                WHERE o."Id" = r."OrderItemOptionId";
                """);
        }
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "OptionNameSnapshot", table: "PaymentRefundRequestItems");
        migrationBuilder.DropColumn(name: "OptionNameSnapshot", table: "PaymentRefundItems");
    }
}
