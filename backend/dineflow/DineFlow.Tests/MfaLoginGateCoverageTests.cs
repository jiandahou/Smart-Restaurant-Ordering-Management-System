using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Every way of signing in has to run the MFA gate. Social sign-in did not, so "Ask for MFA when
/// this account signs in" was a setting one route quietly ignored — worse than not offering it,
/// because the person who switched it on had no way to discover it did not apply.
///
/// <para>
/// Checked against the source because the failure is a new sign-in path being written without the
/// gate. Nothing at runtime notices: the response is a perfectly valid session.
/// </para>
/// </summary>
public sealed class MfaLoginGateCoverageTests
{
    private const string IssuesASession = "BuildAuthenticatedResponseAsync(user";
    private const string RunsTheGate = "CreateMfaLoginChallengeIfRequiredAsync";

    /// <summary>How far above a sign-in the gate may sit and still plainly guard it.</summary>
    private const int LinesOfContext = 12;

    [Fact]
    public void NoSignInIssuesASessionWithoutRunningTheMfaGate()
    {
        var lines = File.ReadAllLines(AuthControllerPath());
        var unguarded = new List<string>();

        for (var index = 0; index < lines.Length; index++)
        {
            if (!lines[index].Contains(IssuesASession, StringComparison.Ordinal))
            {
                continue;
            }

            var from = Math.Max(0, index - LinesOfContext);
            var guarded = lines[from..index].Any(line => line.Contains(RunsTheGate, StringComparison.Ordinal));

            if (!guarded)
            {
                unguarded.Add($"line {index + 1}: {lines[index].Trim()}");
            }
        }

        Assert.True(
            unguarded.Count == 0,
            "These sign in without running the MFA gate first:"
                + Environment.NewLine
                + string.Join(Environment.NewLine, unguarded));
    }

    [Fact]
    public void TheGuardIsLookingAtSomethingRatherThanPassingVacuously()
    {
        // If the marker ever stops matching, the test above would pass by finding nothing at all.
        var source = File.ReadAllText(AuthControllerPath());
        var signIns = source.Split(IssuesASession).Length - 1;

        Assert.True(signIns >= 4, $"Expected several sign-in paths to check, found {signIns}.");
    }

    /// <summary>
    /// Passkey sign-in is deliberately exempt: the assertion already proves possession of the device
    /// and whatever unlocked it, which is the second factor the code would be standing in for. This
    /// is a policy, not an oversight — it is asserted here so that changing it is a decision someone
    /// has to make on purpose, and so the settings page keeps saying so.
    /// </summary>
    [Fact]
    public void PasskeySignInSatisfiesTheLoginRequirementOnItsOwn()
    {
        var source = File.ReadAllText(ControllerPath("PasskeysController.cs"));

        Assert.Contains(IssuesASession, source, StringComparison.Ordinal);
        Assert.DoesNotContain(RunsTheGate, source, StringComparison.Ordinal);
    }

    private static string ControllerPath(string file) =>
        Path.Combine(Path.GetDirectoryName(AuthControllerPath())!, file);

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
