using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPublicOrderingEntryTokens : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                WITH ranked_tokens AS (
                    SELECT
                        "Id",
                        "QrCodeToken",
                        ROW_NUMBER() OVER (
                            PARTITION BY "QrCodeToken"
                            ORDER BY "CreatedAt", "Id") AS token_rank
                    FROM "RestaurantTables"
                )
                UPDATE "RestaurantTables" AS restaurant_table
                SET "QrCodeToken" =
                    replace(gen_random_uuid()::text, '-', '') ||
                    replace(gen_random_uuid()::text, '-', '')
                FROM ranked_tokens
                WHERE restaurant_table."Id" = ranked_tokens."Id"
                  AND (
                      btrim(coalesce(ranked_tokens."QrCodeToken", '')) = ''
                      OR length(ranked_tokens."QrCodeToken") > 64
                      OR ranked_tokens.token_rank > 1
                  );
                """);

            migrationBuilder.AlterColumn<string>(
                name: "TableNumber",
                table: "RestaurantTables",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AlterColumn<string>(
                name: "QrCodeToken",
                table: "RestaurantTables",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddCheckConstraint(
                name: "CK_RestaurantTables_QrToken_NotEmpty",
                table: "RestaurantTables",
                sql: "length(\"QrCodeToken\") > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_RestaurantTables_QrToken_NotEmpty",
                table: "RestaurantTables");

            migrationBuilder.AlterColumn<string>(
                name: "TableNumber",
                table: "RestaurantTables",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(40)",
                oldMaxLength: 40);

            migrationBuilder.AlterColumn<string>(
                name: "QrCodeToken",
                table: "RestaurantTables",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64);
        }
    }
}
