using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class EnforceUniqueStripeRefundIds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PaymentRefunds_ProviderRefundId",
                table: "PaymentRefunds");

            // Earlier timeout recovery could create two local rows for the same Stripe refund.
            // Keep the oldest successful row (or simply the oldest row when neither succeeded),
            // move request links to it, and make duplicate rows non-financial before enforcing the
            // provider-id uniqueness invariant.
            migrationBuilder.Sql(
                """
                WITH ranked AS (
                    SELECT
                        "Id",
                        FIRST_VALUE("Id") OVER (
                            PARTITION BY "ProviderRefundId"
                            ORDER BY CASE WHEN "Status" = 1 THEN 0 ELSE 1 END, "CreatedAt", "Id"
                        ) AS "KeeperId",
                        ROW_NUMBER() OVER (
                            PARTITION BY "ProviderRefundId"
                            ORDER BY CASE WHEN "Status" = 1 THEN 0 ELSE 1 END, "CreatedAt", "Id"
                        ) AS "RowNumber"
                    FROM "PaymentRefunds"
                    WHERE "ProviderRefundId" IS NOT NULL
                )
                UPDATE "PaymentRefundRequests" AS request
                SET "PaymentRefundId" = ranked."KeeperId",
                    "UpdatedAt" = NOW()
                FROM ranked
                WHERE request."PaymentRefundId" = ranked."Id"
                  AND ranked."RowNumber" > 1;

                WITH ranked AS (
                    SELECT
                        "Id",
                        ROW_NUMBER() OVER (
                            PARTITION BY "ProviderRefundId"
                            ORDER BY CASE WHEN "Status" = 1 THEN 0 ELSE 1 END, "CreatedAt", "Id"
                        ) AS "RowNumber"
                    FROM "PaymentRefunds"
                    WHERE "ProviderRefundId" IS NOT NULL
                )
                UPDATE "PaymentRefunds" AS refund
                SET "ProviderRefundId" = NULL,
                    "Status" = 2,
                    "FailureReason" = COALESCE(
                        refund."FailureReason",
                        'Duplicate local record consolidated before enforcing provider refund uniqueness.'
                    ),
                    "FailedAt" = COALESCE(refund."FailedAt", NOW()),
                    "UpdatedAt" = NOW()
                FROM ranked
                WHERE refund."Id" = ranked."Id"
                  AND ranked."RowNumber" > 1;

                UPDATE "PaymentRefundRequests" AS request
                SET "Status" = CASE
                        WHEN refund."Status" = 1 THEN 1
                        WHEN refund."Status" = 0 THEN 4
                        ELSE 0
                    END,
                    "PaymentRefundId" = CASE
                        WHEN refund."Status" = 2 THEN NULL
                        ELSE refund."Id"
                    END,
                    "ReviewedAt" = CASE
                        WHEN refund."Status" = 1 THEN COALESCE(request."ReviewedAt", NOW())
                        ELSE request."ReviewedAt"
                    END,
                    "UpdatedAt" = NOW()
                FROM "PaymentRefunds" AS refund
                WHERE request."PaymentRefundId" = refund."Id";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefunds_ProviderRefundId",
                table: "PaymentRefunds",
                column: "ProviderRefundId",
                unique: true,
                filter: "\"ProviderRefundId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PaymentRefunds_ProviderRefundId",
                table: "PaymentRefunds");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefunds_ProviderRefundId",
                table: "PaymentRefunds",
                column: "ProviderRefundId");
        }
    }
}
