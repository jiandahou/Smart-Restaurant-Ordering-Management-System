using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260629120000_AddReportLogImmutabilityTriggers")]
    public partial class AddReportLogImmutabilityTriggers : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION prevent_report_log_mutation()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'Report log entries are immutable and cannot be updated or deleted.';
                END;
                $$ LANGUAGE plpgsql;

                DROP TRIGGER IF EXISTS "TR_AuditLogs_Immutable" ON "AuditLogs";
                CREATE TRIGGER "TR_AuditLogs_Immutable"
                BEFORE UPDATE OR DELETE ON "AuditLogs"
                FOR EACH ROW EXECUTE FUNCTION prevent_report_log_mutation();

                DROP TRIGGER IF EXISTS "TR_OrderEventLogs_Immutable" ON "OrderEventLogs";
                CREATE TRIGGER "TR_OrderEventLogs_Immutable"
                BEFORE UPDATE OR DELETE ON "OrderEventLogs"
                FOR EACH ROW EXECUTE FUNCTION prevent_report_log_mutation();

                DROP TRIGGER IF EXISTS "TR_PaymentEventLogs_Immutable" ON "PaymentEventLogs";
                CREATE TRIGGER "TR_PaymentEventLogs_Immutable"
                BEFORE UPDATE OR DELETE ON "PaymentEventLogs"
                FOR EACH ROW EXECUTE FUNCTION prevent_report_log_mutation();
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_PaymentEventLogs_Immutable" ON "PaymentEventLogs";
                DROP TRIGGER IF EXISTS "TR_OrderEventLogs_Immutable" ON "OrderEventLogs";
                DROP TRIGGER IF EXISTS "TR_AuditLogs_Immutable" ON "AuditLogs";
                DROP FUNCTION IF EXISTS prevent_report_log_mutation();
                """);
        }
    }
}
