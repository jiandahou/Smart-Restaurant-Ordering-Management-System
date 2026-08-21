using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <summary>
    /// Lets a declared retention run delete expired report evidence, and nothing else delete any.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The triggers blocked every UPDATE and DELETE, which is why the published retention periods
    /// were enforced by nothing: there was no way to honour them without turning the guarantee off.
    /// </para>
    /// <para>
    /// A retention run now declares itself for the length of one transaction. This is a statement of
    /// intent, not a permission — any session could set the same flag. The permission boundary stays
    /// where it belongs, in the GRANT: the web runtime's role has no DELETE on these tables, and the
    /// maintenance role does. What the flag buys is that nothing deletes report evidence by accident,
    /// and that a deliberate deletion is visible in the statement that did it.
    /// </para>
    /// <para>
    /// UPDATE remains refused unconditionally. Retention removes evidence whose period has run out;
    /// it never edits it, and no flag should make that possible.
    /// </para>
    /// </remarks>
    [DbContext(typeof(AppDbContext))]
    [Migration("20260821063000_AllowRetentionDeletes")]
    public partial class AllowRetentionDeletes : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION prevent_report_log_mutation()
                RETURNS trigger AS $$
                BEGIN
                    IF TG_OP = 'DELETE'
                       AND coalesce(current_setting('dineflow.retention_maintenance', true), 'off') = 'on' THEN
                        RETURN OLD;
                    END IF;

                    RAISE EXCEPTION 'Report log entries are immutable and cannot be updated or deleted.';
                END;
                $$ LANGUAGE plpgsql;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION prevent_report_log_mutation()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'Report log entries are immutable and cannot be updated or deleted.';
                END;
                $$ LANGUAGE plpgsql;
                """);
        }
    }
}
