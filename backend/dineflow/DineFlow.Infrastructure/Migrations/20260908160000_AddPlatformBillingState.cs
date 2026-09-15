using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Gives the platform's fees a standing, so that being paid or unpaid can finally mean something.
///
/// <para>
/// The activation fee has been chargeable and reconcilable for a while, and nothing has ever read
/// the result: every use of the paid flag either prints it on a screen or belongs to the charging
/// flow itself. A restaurant that has never paid the platform is, today, indistinguishable from one
/// that has.
/// </para>
///
/// <para>
/// Five columns, and between them three separate locks on ever closing a shop. The model says
/// whether anything is owed at all — and it defaults to None, which is what every existing
/// restaurant gets, so applying this migration changes nothing for anybody. The delinquency instant
/// is the single clock, from which the deadline is derived rather than stored, so the grace period
/// stays one constant instead of a date copied onto every row. The enforcement date is the promise
/// made in advance, per restaurant, without which no arithmetic can suspend anyone. And the sync
/// instant records when Stripe last confirmed any of it, because a suspension is only as good as
/// the payment record behind it and that record arrives by webhook — which is to say, sometimes it
/// does not.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260908160000_AddPlatformBillingState")]
public partial class AddPlatformBillingState : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "PlatformBillingModel",
            table: "Restaurants",
            type: "integer",
            nullable: false,
            defaultValue: 0);

        foreach (var column in new[]
                 {
                     "PlatformBillingDelinquentSince",
                     "PlatformBillingEnforcedFrom",
                     "PlatformBillingSuspendedAt",
                     "PlatformBillingSyncedAt",
                 })
        {
            migrationBuilder.AddColumn<DateTime>(
                name: column,
                table: "Restaurants",
                type: "timestamp with time zone",
                nullable: true);
        }

        migrationBuilder.AddCheckConstraint(
            name: "CK_Restaurants_PlatformBillingModel",
            table: "Restaurants",
            sql: "\"PlatformBillingModel\" IN (0, 1, 2)");

        // The sweep asks for the restaurants that owe something and whose facts have gone stale,
        // which is a handful out of every restaurant on the platform.
        migrationBuilder.CreateIndex(
            name: "IX_Restaurants_PlatformBillingModel_PlatformBillingSyncedAt",
            table: "Restaurants",
            columns: ["PlatformBillingModel", "PlatformBillingSyncedAt"]);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_Restaurants_PlatformBillingModel_PlatformBillingSyncedAt",
            table: "Restaurants");
        migrationBuilder.DropCheckConstraint(
            name: "CK_Restaurants_PlatformBillingModel",
            table: "Restaurants");

        foreach (var column in new[]
                 {
                     "PlatformBillingModel",
                     "PlatformBillingDelinquentSince",
                     "PlatformBillingEnforcedFrom",
                     "PlatformBillingSuspendedAt",
                     "PlatformBillingSyncedAt",
                 })
        {
            migrationBuilder.DropColumn(name: column, table: "Restaurants");
        }
    }
}
