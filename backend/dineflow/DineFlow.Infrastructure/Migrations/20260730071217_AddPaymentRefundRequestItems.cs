using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentRefundRequestItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaymentRefundRequestItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentRefundRequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemNameSnapshot = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    AmountCents = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentRefundRequestItems", x => x.Id);
                    table.CheckConstraint("CK_PaymentRefundRequestItems_AmountCents", "\"AmountCents\" > 0");
                    table.CheckConstraint("CK_PaymentRefundRequestItems_Quantity", "\"Quantity\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentRefundRequestItems_PaymentRefundRequests_PaymentRefu~",
                        column: x => x.PaymentRefundRequestId,
                        principalTable: "PaymentRefundRequests",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequestItems_OrderItemId",
                table: "PaymentRefundRequestItems",
                column: "OrderItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequestItems_PaymentRefundRequestId",
                table: "PaymentRefundRequestItems",
                column: "PaymentRefundRequestId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentRefundRequestItems");
        }
    }
}
