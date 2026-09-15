using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using DineFlow.Infrastructure.Persistence;

#nullable disable

namespace DineFlow.Infrastructure.Migrations;

/// <summary>
/// Gives each sign-in its own chain of refresh tokens, so reuse detection stops one device
/// signing out the rest.
///
/// <para>
/// Replaying an already-rotated refresh token is the signature of a stolen copy, and the answer is
/// to kill the family it belongs to: nobody can tell which of the two holders is the owner, so both
/// are made to sign in again. That is standard, and it is not what was implemented — the family was
/// every token the account held. A tab suspended by the browser, waking with a token its siblings
/// had rotated minutes earlier, was read as a thief and signed the account out everywhere. It was
/// reproduced here on a live session: two tokens revoked in the same instant, nine minutes after
/// the rotation that stranded the one replayed.
/// </para>
///
/// <para>
/// The backfill walks each existing chain from its root so that tokens already linked by rotation
/// keep sharing a session. Roots are tokens nothing was rotated into; every descendant inherits the
/// root's id. A token standing alone is its own session, which is the truthful answer for one.
/// </para>
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260908100000_ScopeRefreshTokenFamiliesToSessions")]
public partial class ScopeRefreshTokenFamiliesToSessions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Added nullable, backfilled, then tightened: every existing row belongs to a chain that
        // can be named, so none of them needs a placeholder and the column ends up as strict as a
        // freshly created one.
        migrationBuilder.AddColumn<Guid>(
            name: "SessionId",
            table: "RefreshTokens",
            type: "uuid",
            nullable: true);

        migrationBuilder.Sql("""
            WITH RECURSIVE chain AS (
                SELECT r."Id", r."Id" AS root, r."ReplacedByTokenHash"
                  FROM "RefreshTokens" r
                 WHERE NOT EXISTS (
                       SELECT 1 FROM "RefreshTokens" parent
                        WHERE parent."ReplacedByTokenHash" = r."TokenHash")
                UNION ALL
                SELECT child."Id", chain.root, child."ReplacedByTokenHash"
                  FROM "RefreshTokens" child
                  JOIN chain ON child."TokenHash" = chain."ReplacedByTokenHash"
            )
            UPDATE "RefreshTokens" r
               SET "SessionId" = chain.root
              FROM chain
             WHERE chain."Id" = r."Id";
            """);

        migrationBuilder.AlterColumn<Guid>(
            name: "SessionId",
            table: "RefreshTokens",
            type: "uuid",
            nullable: false,
            oldClrType: typeof(Guid),
            oldType: "uuid",
            oldNullable: true);

        // Revoking a session reads every token that shares one, which is the whole of the new rule.
        migrationBuilder.CreateIndex(
            name: "IX_RefreshTokens_SessionId",
            table: "RefreshTokens",
            column: "SessionId");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_RefreshTokens_SessionId", table: "RefreshTokens");
        migrationBuilder.DropColumn(name: "SessionId", table: "RefreshTokens");
    }
}
