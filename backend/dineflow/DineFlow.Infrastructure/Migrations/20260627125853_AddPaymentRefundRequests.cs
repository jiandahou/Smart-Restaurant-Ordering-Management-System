using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentRefundRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PaymentRefundRequests",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OrderId = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentId = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentRefundId = table.Column<Guid>(type: "uuid", nullable: true),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    RequestedAmountCents = table.Column<long>(type: "bigint", nullable: false),
                    Currency = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    AdminNote = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    RequestedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    RequesterName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RequesterEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ReviewedByUserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentRefundRequests", x => x.Id);
                    table.CheckConstraint("CK_PaymentRefundRequests_RequestedAmountCents", "\"RequestedAmountCents\" > 0");
                    table.ForeignKey(
                        name: "FK_PaymentRefundRequests_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PaymentRefundRequests_PaymentRefunds_PaymentRefundId",
                        column: x => x.PaymentRefundId,
                        principalTable: "PaymentRefunds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PaymentRefundRequests_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequests_OrderId",
                table: "PaymentRefundRequests",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequests_PaymentId",
                table: "PaymentRefundRequests",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequests_PaymentRefundId",
                table: "PaymentRefundRequests",
                column: "PaymentRefundId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequests_RestaurantId",
                table: "PaymentRefundRequests",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefundRequests_Status",
                table: "PaymentRefundRequests",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentRefundRequests");
        }
    }
}
