using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Confirming an email change rewrites the account's identity. Three things about that step were
/// wrong at once: the address and the username were written in two separate saves that could half
/// succeed, sessions issued to the old identity outlived it, and the confirmation email never said
/// which account was being moved.
///
/// <para>
/// Asserted against the source because none of it fails at runtime — a half-changed account, a
/// surviving session and a vague email are all perfectly ordinary successful responses.
/// </para>
/// </summary>
public sealed class EmailChangeIntegrityTests
{
    private static string ConfirmAction() => ActionBody("HttpPost(\"confirm-email-change\")");

    [Fact]
    public void TheAddressAndTheUsernameAreWrittenInOneTransaction()
    {
        // ChangeEmailAsync and SetUserNameAsync each save on their own. A failure between them left
        // the account signing in under the old username while mail went to the new address.
        var body = ConfirmAction();

        var transaction = body.IndexOf("BeginTransactionAsync", StringComparison.Ordinal);
        var changeEmail = body.IndexOf("ChangeEmailAsync", StringComparison.Ordinal);
        var setUserName = body.IndexOf("SetUserNameAsync", StringComparison.Ordinal);
        var commit = body.IndexOf("CommitAsync", StringComparison.Ordinal);

        Assert.True(transaction >= 0, "The confirm step opens no transaction.");
        Assert.True(transaction < changeEmail, "The transaction must be open before the email is written.");
        Assert.True(setUserName > changeEmail, "The username is written after the email.");
        Assert.True(commit > setUserName, "Nothing may commit until both writes have succeeded.");
    }

    [Fact]
    public void AFailedUsernameWriteDoesNotClaimTheEmailAlreadyChanged()
    {
        // The old copy told the person their address had changed and the rest had not, which was
        // both alarming and, once the write is transactional, untrue.
        var body = ConfirmAction();

        Assert.DoesNotContain("Email was changed, but username update failed", body, StringComparison.Ordinal);
        Assert.Contains("Your address is unchanged", body, StringComparison.Ordinal);
    }

    [Fact]
    public void EverySessionIsEndedWhenTheIdentityChanges()
    {
        // On a stolen account the session the real owner cannot see is exactly the one that used to
        // survive this.
        var body = ConfirmAction();

        var revoke = body.IndexOf("RevokeAllForUserAsync", StringComparison.Ordinal);
        var commit = body.IndexOf("CommitAsync", StringComparison.Ordinal);

        Assert.True(revoke >= 0, "Sessions are not revoked when the address changes.");
        Assert.True(revoke < commit, "Revocation must be part of the same transaction.");
    }

    [Fact]
    public void TheConfirmationEmailNamesBothAddresses()
    {
        // Naming only the new address leaves the reader unable to tell an expected change from
        // someone moving an account they do not own onto this inbox.
        var body = ActionBody("private async Task SendEmailChangeConfirmationAsync");

        // Both in the same sentence: "the account X is being changed to Y". Mentioning the current
        // address only in a later line about what happens if nothing is confirmed is not the same.
        Assert.Contains("on the DineFlow account", body, StringComparison.Ordinal);
        Assert.Contains("{user.Email} to {newEmail}", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheConfirmationEmailWarnsThatConfirmingSignsYouOut()
    {
        // Revoking every session is a surprise worth stating before the button is pressed.
        Assert.Contains(
            "signs you out everywhere",
            ActionBody("private async Task SendEmailChangeConfirmationAsync"),
            StringComparison.Ordinal);
    }

    [Fact]
    public void TheAddressBeingReplacedIsToldAtBothMoments()
    {
        // If the account is already someone else's, this is the only message the real owner gets:
        // the new address is one the attacker watches, the old one is not.
        Assert.Contains("TrySendEmailChangeNoticeAsync", ActionBody("HttpPost(\"request-email-change\")"), StringComparison.Ordinal);
        Assert.Contains("TrySendEmailChangeNoticeAsync", ConfirmAction(), StringComparison.Ordinal);
    }

    [Fact]
    public void TheNoticeIsSentAfterTheChangeIsCommitted()
    {
        // Mail is best effort; a send that throws must not roll back a change that already happened.
        var body = ConfirmAction();

        Assert.True(
            body.IndexOf("CommitAsync", StringComparison.Ordinal)
                < body.IndexOf("TrySendEmailChangeNoticeAsync", StringComparison.Ordinal),
            "The notice must be sent after the commit, not inside the transaction.");
    }

    [Fact]
    public void ThePasswordResetOfferStopsOnceItWouldReachTheWrongInbox()
    {
        // After the change, a reset link goes to the new address. Offering it to the person reading
        // this would send them chasing a link that lands in someone else's inbox.
        var notice = ActionBody("private async Task TrySendEmailChangeNoticeAsync");

        Assert.Contains("alreadyChanged ? null : \"Reset your password\"", notice, StringComparison.Ordinal);
        Assert.Contains("no longer reach this inbox", notice, StringComparison.Ordinal);
    }

    /// <summary>The source of one method, from its declaration to the next one.</summary>
    private static string ActionBody(string marker)
    {
        var source = File.ReadAllText(AuthControllerPath());
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);

        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string AuthControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "AuthController.cs");
    }
}
