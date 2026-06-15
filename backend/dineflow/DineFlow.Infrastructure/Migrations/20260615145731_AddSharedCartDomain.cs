using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DineFlow.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSharedCartDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Carts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RestaurantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TableId = table.Column<Guid>(type: "uuid", nullable: true),
                    OrderType = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CustomerNote = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Carts", x => x.Id);
                    table.CheckConstraint("CK_Carts_ExpiresAt", "\"ExpiresAt\" > \"CreatedAt\"");
                    table.CheckConstraint("CK_Carts_OrderType", "\"OrderType\" IN (0, 1, 2)");
                    table.CheckConstraint("CK_Carts_Status", "\"Status\" IN (0, 1, 2)");
                    table.CheckConstraint("CK_Carts_TableOrderType", "(\"OrderType\" = 0 AND \"TableId\" IS NOT NULL) OR (\"OrderType\" <> 0 AND \"TableId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_Carts_RestaurantTables_TableId",
                        column: x => x.TableId,
                        principalTable: "RestaurantTables",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Carts_Restaurants_RestaurantId",
                        column: x => x.RestaurantId,
                        principalTable: "Restaurants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CartItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CartId = table.Column<Guid>(type: "uuid", nullable: false),
                    MenuItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartItems", x => x.Id);
                    table.CheckConstraint("CK_CartItems_Quantity", "\"Quantity\" > 0");
                    table.ForeignKey(
                        name: "FK_CartItems_Carts_CartId",
                        column: x => x.CartId,
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CartItems_MenuItems_MenuItemId",
                        column: x => x.MenuItemId,
                        principalTable: "MenuItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CartParticipants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CartId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerId = table.Column<string>(type: "character varying(450)", maxLength: 450, nullable: true),
                    ParticipantTokenHash = table.Column<byte[]>(type: "bytea", fixedLength: true, maxLength: 32, nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CartParticipants", x => x.Id);
                    table.CheckConstraint("CK_CartParticipants_TokenHashLength", "octet_length(\"ParticipantTokenHash\") = 32");
                    table.ForeignKey(
                        name: "FK_CartParticipants_AspNetUsers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_CartParticipants_Carts_CartId",
                        column: x => x.CartId,
                        principalTable: "Carts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CartItems_CartId",
                table: "CartItems",
                column: "CartId");

            migrationBuilder.CreateIndex(
                name: "IX_CartItems_CartId_MenuItemId",
                table: "CartItems",
                columns: new[] { "CartId", "MenuItemId" });

            migrationBuilder.CreateIndex(
                name: "IX_CartItems_MenuItemId",
                table: "CartItems",
                column: "MenuItemId");

            migrationBuilder.CreateIndex(
                name: "IX_CartParticipants_CartId",
                table: "CartParticipants",
                column: "CartId");

            migrationBuilder.CreateIndex(
                name: "IX_CartParticipants_CustomerId",
                table: "CartParticipants",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_CartParticipants_ParticipantTokenHash",
                table: "CartParticipants",
                column: "ParticipantTokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Carts_ExpiresAt",
                table: "Carts",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_RestaurantId",
                table: "Carts",
                column: "RestaurantId");

            migrationBuilder.CreateIndex(
                name: "IX_Carts_TableId_Active",
                table: "Carts",
                column: "TableId",
                unique: true,
                filter: "\"Status\" = 0 AND \"TableId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CartItems");

            migrationBuilder.DropTable(
                name: "CartParticipants");

            migrationBuilder.DropTable(
                name: "Carts");
        }
    }
}
