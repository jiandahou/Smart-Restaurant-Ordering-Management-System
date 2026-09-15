using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A cart participant token is the credential for a public cart. Authorization bound a participant
/// to a signed-in customer when a guest signed in, and never looked at the reverse: after signing
/// out, the same tab kept sending the same token, the participant stayed bound to the account that
/// had left, and the order it placed carried that customer's id. The browser said "Ordering as
/// Guest" while the restaurant's order list showed the previous customer's name and email.
///
/// <para>
/// Asserted against the source. Nothing fails at runtime — an order attributed to the wrong person
/// is an ordinary successful order.
/// </para>
/// </summary>
public sealed class CartParticipantIdentityTests
{
    private static string AuthorizeBody() => MemberBody("private async Task<CartAccessResult> AuthorizeCartAsync");

    [Fact]
    public void AParticipantOwnedByAnAccountIsRefusedToAnyoneElse()
    {
        // Covers both directions at once: the signed-out tab, and a second account picking the
        // token up. Both used to be silently accepted.
        var body = AuthorizeBody();

        Assert.Contains("participantIsOwned", body, StringComparison.Ordinal);
        Assert.Contains("participant_identity_changed", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheRefusalHappensBeforeTheParticipantIsHandedBack()
    {
        // Returning the participant alongside an error would let a caller that ignores the error
        // keep using it.
        var body = AuthorizeBody();

        var refusal = body.IndexOf("participant_identity_changed", StringComparison.Ordinal);
        var claim = body.IndexOf("access.Participant.CustomerId = currentUserId", StringComparison.Ordinal);

        Assert.True(refusal >= 0 && claim > refusal, "The ownership check must run before the claim.");
    }

    [Fact]
    public void AGuestWhoSignsInStillClaimsTheirOwnParticipant()
    {
        // The behaviour that was already correct: browsing as a guest and signing in at checkout
        // must not throw the cart away.
        var body = AuthorizeBody();

        Assert.Contains("callerIsSignedIn && !participantIsOwned", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AnOrderIsAttributedToTheCallerAndNobodyElse()
    {
        // The fallback to the participant's stored customer is how an anonymous request placed an
        // order under someone else's account.
        var body = MemberBody("HttpPost(\"{cartId:guid}/checkout\")");

        Assert.DoesNotContain("?? access.Participant?.CustomerId", body, StringComparison.Ordinal);
        Assert.Contains("var orderCustomerId = User.FindFirstValue(ClaimTypes.NameIdentifier);", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheRefusalIsDistinguishableFromAPlainBadToken()
    {
        // The client has to tell "your session moved on, start a new cart" apart from "this token
        // is wrong", because only the first one is safe to recover from automatically.
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("code = \"participant_identity_changed\"", source, StringComparison.Ordinal);
    }

    /// <summary>The source of one member, from its marker to the next one.</summary>
    private static string MemberBody(string marker)
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start + 1, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + 1, StringComparison.Ordinal);

        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);
        return end < 0 ? source[start..] : source[start..end];
    }

    private static string ControllerPath()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", "PublicCartsController.cs");
    }
}
