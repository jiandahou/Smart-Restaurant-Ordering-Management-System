using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Remembers cart mutations that have already been applied, so a retry cannot apply them twice.
///
/// <para>
/// Adding an item does <c>Quantity += request.Quantity</c>. A phone that loses signal after the
/// server committed but before the response arrived cannot tell that apart from a request that
/// never landed, and retrying is the only thing it can do — so one tap became two portions, and the
/// customer paid for both.
/// </para>
///
/// <para>
/// The key is claimed in the same transaction as the mutation, so it exists if and only if the
/// change did.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260811130000_AddCartMutationIdempotency")]
public partial class AddCartMutationIdempotency : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "CartMutations",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uuid", nullable: false),
                CartId = table.Column<Guid>(type: "uuid", nullable: false),
                IdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_CartMutations", x => x.Id);
                // Keys die with the cart they belong to, so nothing has to be swept by hand.
                table.ForeignKey(
                    name: "FK_CartMutations_Carts_CartId",
                    column: x => x.CartId,
                    principalTable: "Carts",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        // The mechanism itself: this constraint is what distinguishes a retry from a first attempt.
        migrationBuilder.CreateIndex(
            name: "IX_CartMutations_CartId_IdempotencyKey",
            table: "CartMutations",
            columns: ["CartId", "IdempotencyKey"],
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_CartMutations_CreatedAt",
            table: "CartMutations",
            column: "CreatedAt");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "CartMutations");
    }
}
