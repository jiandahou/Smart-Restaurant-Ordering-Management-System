using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddUserMfaSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "UserMfaSettings",
                columns: table => new
                {
                    UserId = table.Column<string>(type: "text", nullable: false),
                    TotpEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    TotpSecret = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    EmailEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    PreferredMethod = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "totp"),
                    RequireForLogin = table.Column<bool>(type: "boolean", nullable: false),
                    RequireForPayment = table.Column<bool>(type: "boolean", nullable: false),
                    RequireForSensitiveActions = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserMfaSettings", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_UserMfaSettings_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserMfaSettings");
        }
    }
}
