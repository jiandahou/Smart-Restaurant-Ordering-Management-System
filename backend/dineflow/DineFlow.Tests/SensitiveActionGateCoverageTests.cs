using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// "Protect security changes and account recovery actions" was enforced on passkeys and the
/// password, but not on the email address — the one change that hands over the account, since every
/// reset link and email code follows it to the new inbox.
///
/// <para>
/// Checked against the source for the same reason as the login gate: a change endpoint written
/// without the check returns a perfectly ordinary success, and nothing at runtime notices.
/// </para>
/// </summary>
public sealed class SensitiveActionGateCoverageTests
{
    private const string RunsTheGate = "ValidateSensitiveActionAsync";

    /// <summary>
    /// Endpoints that change what the account is or how it is proved, as route and file. Confirming
    /// an email change is deliberately absent: it is reached from a link that may be opened on
    /// another device, where the emailed token is the proof and the request step carried the check.
    /// </summary>
    public static TheoryData<string, string> ProtectedEndpoints() => new()
    {
        { "AuthController.cs", "request-email-change" },
        { "AuthController.cs", "me/request-password-reset" },
        { "PasskeysController.cs", "register/options" },
    };

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public void TheEndpointVerifiesTheSecondFactor(string file, string route)
    {
        var body = ActionBody(file, route);

        Assert.True(
            body.Contains(RunsTheGate, StringComparison.Ordinal),
            $"POST {route} changes the account without running {RunsTheGate}.");
    }

    [Fact]
    public void ChangingTheEmailIsGatedAfterThePasswordCheck()
    {
        // Order matters: an attacker without the password should learn nothing about the MFA state.
        var body = ActionBody("AuthController.cs", "request-email-change");

        var password = body.IndexOf("CheckPasswordAsync", StringComparison.Ordinal);
        var mfa = body.IndexOf(RunsTheGate, StringComparison.Ordinal);

        Assert.True(password >= 0 && mfa > password, "The MFA check must follow the password check.");
    }

    /// <summary>The source of one action, from its route attribute to the next one.</summary>
    private static string ActionBody(string file, string route)
    {
        var source = File.ReadAllText(ControllerPath(file));
        var start = source.IndexOf($"HttpPost(\"{route}\")", StringComparison.Ordinal);

        Assert.True(start >= 0, $"No POST {route} in {file} — has it been renamed?");

        var next = source.IndexOf("    [Http", start + 1, StringComparison.Ordinal);
        return next < 0 ? source[start..] : source[start..next];
    }

    private static string ControllerPath(string file)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", file);
    }
}
