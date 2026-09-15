using System;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260808120000_AddPaymentRefundItemAllocations")]
    public partial class AddPaymentRefundItemAllocations : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaymentRefundItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentRefundId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemNameSnapshot = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    AmountCents = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentRefundItems", x => x.Id);
                    table.CheckConstraint("CK_PaymentRefundItems_AmountCents", "\"AmountCents\" > 0");
                    table.CheckConstraint("CK_PaymentRefundItems_Quantity", "\"Quantity\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentRefundItems_PaymentRefunds_PaymentRefundId",
                        column: x => x.PaymentRefundId,
                        principalTable: "PaymentRefunds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundItems_OrderItemId",
                table: "PaymentRefundItems",
                column: "OrderItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundItems_PaymentRefundId",
                table: "PaymentRefundItems",
                column: "PaymentRefundId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundItems_PaymentRefundId_OrderItemId",
                table: "PaymentRefundItems",
                columns: new[] { "PaymentRefundId", "OrderItemId" },
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "PaymentRefundItems");
        }
    }
}
