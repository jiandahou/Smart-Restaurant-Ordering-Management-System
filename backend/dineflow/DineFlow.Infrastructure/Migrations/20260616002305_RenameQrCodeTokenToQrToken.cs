using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class RenameQrCodeTokenToQrToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'RestaurantTables'
                          AND column_name = 'QrCodeToken'
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'RestaurantTables'
                          AND column_name = 'QrToken'
                    ) THEN
                        ALTER TABLE "RestaurantTables"
                        RENAME COLUMN "QrCodeToken" TO "QrToken";
                    END IF;
                END $$;
                """);

            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF to_regclass('"IX_RestaurantTables_QrCodeToken"') IS NOT NULL THEN
                        IF to_regclass('"IX_RestaurantTables_QrToken"') IS NULL THEN
                            ALTER INDEX "IX_RestaurantTables_QrCodeToken"
                            RENAME TO "IX_RestaurantTables_QrToken";
                        ELSE
                            DROP INDEX "IX_RestaurantTables_QrCodeToken";
                        END IF;
                    END IF;
                END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'RestaurantTables'
                          AND column_name = 'QrToken'
                    ) AND NOT EXISTS (
                        SELECT 1
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'RestaurantTables'
                          AND column_name = 'QrCodeToken'
                    ) THEN
                        ALTER TABLE "RestaurantTables"
                        RENAME COLUMN "QrToken" TO "QrCodeToken";
                    END IF;
                END $$;
                """);

            migrationBuilder.Sql(
                """
                DO $$
                BEGIN
                    IF to_regclass('"IX_RestaurantTables_QrToken"') IS NOT NULL
                       AND to_regclass('"IX_RestaurantTables_QrCodeToken"') IS NULL THEN
                        ALTER INDEX "IX_RestaurantTables_QrToken"
                        RENAME TO "IX_RestaurantTables_QrCodeToken";
                    END IF;
                END $$;
                """);
        }
    }
}
