using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Data-only cleanup for FS-013.
///
/// <para>
/// AdminMenuItemsController used to stamp <c>AllergenInfoLastVerifiedAt</c> with the current time
/// on every save, whether or not any allergen information had been supplied. Rows created under
/// that behaviour claim their allergen information was verified while all three allergen fields
/// are empty, and that claim is served to customers through the public menu.
/// </para>
///
/// <para>
/// This clears the timestamp wherever there is nothing it could refer to. The controller now only
/// sets it when a declaration is actually present, so the state cannot come back.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260809220000_ClearUnverifiedAllergenTimestamps")]
public partial class ClearUnverifiedAllergenTimestamps : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Whitespace-only values count as empty, matching NormalizeOptionalValue on the write path.
        migrationBuilder.Sql("""
            UPDATE "MenuItems"
            SET "AllergenInfoLastVerifiedAt" = NULL
            WHERE "AllergenInfoLastVerifiedAt" IS NOT NULL
              AND COALESCE(TRIM("Allergens"), '') = ''
              AND COALESCE(TRIM("MayContainAllergens"), '') = ''
              AND COALESCE(TRIM("CrossContactStatement"), '') = '';
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Deliberately not reversible. The discarded timestamps asserted a verification that never
        // happened, so restoring them would mean re-publishing a false food-safety claim — and the
        // original values are not recoverable in any case.
    }
}
