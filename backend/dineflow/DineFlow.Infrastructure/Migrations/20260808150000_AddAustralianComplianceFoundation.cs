using System;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260808150000_AddAustralianComplianceFoundation")]
public partial class AddAustralianComplianceFoundation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>("AcceptedCustomerTermsVersion", "AspNetUsers", "character varying(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<string>("AcknowledgedPrivacyPolicyVersion", "AspNetUsers", "character varying(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<DateTime>("LegalAcceptedAt", "AspNetUsers", "timestamp with time zone", nullable: true);
        migrationBuilder.AddColumn<string>("LegalAcceptanceIpAddress", "AspNetUsers", "character varying(64)", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("LegalAcceptanceUserAgent", "AspNetUsers", "character varying(512)", maxLength: 512, nullable: true);

        migrationBuilder.AddColumn<string>("AcceptedCustomerTermsVersion", "Orders", "character varying(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<string>("AcknowledgedPrivacyPolicyVersion", "Orders", "character varying(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<string>("AcknowledgedAllergenNoticeVersion", "Orders", "character varying(32)", maxLength: 32, nullable: true);
        migrationBuilder.AddColumn<DateTime>("LegalAcceptedAt", "Orders", "timestamp with time zone", nullable: true);
        migrationBuilder.AddColumn<string>("LegalAcceptanceIpAddress", "Orders", "character varying(64)", maxLength: 64, nullable: true);
        migrationBuilder.AddColumn<string>("LegalAcceptanceUserAgent", "Orders", "character varying(512)", maxLength: 512, nullable: true);

        migrationBuilder.AddColumn<string>("LegalBusinessName", "Restaurants", "character varying(160)", maxLength: 160, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("Abn", "Restaurants", "character varying(11)", maxLength: 11, nullable: true);
        migrationBuilder.AddColumn<bool>("GstRegistered", "Restaurants", "boolean", nullable: false, defaultValue: false);
        migrationBuilder.AddColumn<bool>("PricesIncludeGst", "Restaurants", "boolean", nullable: false, defaultValue: true);
        migrationBuilder.AddColumn<string>("BusinessContactEmail", "Restaurants", "character varying(256)", maxLength: 256, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("RefundContactEmail", "Restaurants", "character varying(256)", maxLength: 256, nullable: false, defaultValue: "");
        migrationBuilder.AddColumn<string>("CustomerSurchargeNotice", "Restaurants", "character varying(300)", maxLength: 300, nullable: true);

        migrationBuilder.AddColumn<string>("MayContainAllergens", "MenuItems", "character varying(500)", maxLength: 500, nullable: true);
        migrationBuilder.AddColumn<string>("CrossContactStatement", "MenuItems", "character varying(1000)", maxLength: 1000, nullable: true);
        migrationBuilder.AddColumn<DateTime>("AllergenInfoLastVerifiedAt", "MenuItems", "timestamp with time zone", nullable: true);

        migrationBuilder.CreateTable(
            name: "PrivacyRequests",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                UserId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: false),
                RequestType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                Details = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_PrivacyRequests", x => x.Id);
                table.ForeignKey("FK_PrivacyRequests_AspNetUsers_UserId", x => x.UserId, "AspNetUsers", "Id", onDelete: ReferentialAction.Restrict);
            });
        migrationBuilder.CreateIndex("IX_PrivacyRequests_UserId_CreatedAt", "PrivacyRequests", new[] { "UserId", "CreatedAt" });
        migrationBuilder.CreateIndex("IX_PrivacyRequests_Status_CreatedAt", "PrivacyRequests", new[] { "Status", "CreatedAt" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("PrivacyRequests");
        foreach (var column in new[] { "AcceptedCustomerTermsVersion", "AcknowledgedPrivacyPolicyVersion", "AcknowledgedAllergenNoticeVersion", "LegalAcceptedAt", "LegalAcceptanceIpAddress", "LegalAcceptanceUserAgent" })
            migrationBuilder.DropColumn(column, "Orders");
        foreach (var column in new[] { "AcceptedCustomerTermsVersion", "AcknowledgedPrivacyPolicyVersion", "LegalAcceptedAt", "LegalAcceptanceIpAddress", "LegalAcceptanceUserAgent" })
            migrationBuilder.DropColumn(column, "AspNetUsers");
        foreach (var column in new[] { "LegalBusinessName", "Abn", "GstRegistered", "PricesIncludeGst", "BusinessContactEmail", "RefundContactEmail", "CustomerSurchargeNotice" })
            migrationBuilder.DropColumn(column, "Restaurants");
        foreach (var column in new[] { "MayContainAllergens", "CrossContactStatement", "AllergenInfoLastVerifiedAt" })
            migrationBuilder.DropColumn(column, "MenuItems");
    }
}
