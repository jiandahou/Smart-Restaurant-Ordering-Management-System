using System.Reflection;
using DineFlow.Api.Options;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Every setting the API reads has to appear in the guide someone deploys from.
/// </summary>
/// <remarks>
/// <para>
/// The staging guide listed six Stripe settings while the API read fourteen. Following it produced
/// a service that started, answered health checks and took card payments — and could not onboard a
/// restaurant, could not finish an activation fee, and could not tell a connected account's webhook
/// from the platform's. Nothing failed loudly; the features simply were not there.
/// </para>
/// <para>
/// Documentation drifts from code because nothing makes it hurt at the time. This is the thing that
/// makes it hurt at the time: add a setting, and the build asks you to write down what a deployer
/// should put in it.
/// </para>
/// <para>
/// It checks that each key is mentioned, not what is said about it — a test cannot judge whether
/// the sentence is any good, and pretending otherwise would just teach people to paste the name in
/// to silence it. Being named at all is the part that was missing.
/// </para>
/// </remarks>
public class DeploymentConfigurationDocsTests
{
    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "CLAUDE.md")))
        {
            directory = directory.Parent;
        }

        Assert.True(
            directory is not null,
            $"Could not find the repository root above {AppContext.BaseDirectory}. These tests read "
            + "the deployment guide from the checkout, so they need to run inside one.");

        return directory!.FullName;
    }

    private static string ReadDoc(string relativePath) =>
        File.ReadAllText(Path.Combine(RepositoryRoot(), relativePath));

    /// <summary>The environment-variable form of a settings key, as a deployer types it.</summary>
    private static IEnumerable<string> KeysOf<TOptions>(string sectionName) =>
        typeof(TOptions)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.CanWrite)
            .Select(property => $"{sectionName}__{property.Name}");

    public static TheoryData<string> StripeKeys()
    {
        var data = new TheoryData<string>();
        foreach (var key in KeysOf<StripeOptions>(StripeOptions.SectionName))
        {
            data.Add(key);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(StripeKeys))]
    public void EveryStripeSettingIsInTheDeploymentGuide(string key)
    {
        Assert.Contains(key, ReadDoc("docs/deployment/aws-staging.md"), StringComparison.Ordinal);
    }

    /// <summary>
    /// Whether unpaid restaurants are actually stopped decides whether a shop can trade. A deployer
    /// who never sees the setting inherits whichever default the build happened to ship.
    /// </summary>
    [Fact]
    public void WhetherBillingIsEnforcedIsInTheDeploymentGuide()
    {
        Assert.Contains(
            $"{PlatformBillingOptions.SectionName}__{nameof(PlatformBillingOptions.EnforcementEnabled)}",
            ReadDoc("docs/deployment/aws-staging.md"),
            StringComparison.Ordinal);
    }

    /// <summary>
    /// Production refuses to start without these, so a guide that omits them turns a missing line
    /// of configuration into a container that will not boot and does not say why until you read the
    /// logs.
    /// </summary>
    [Fact]
    public void TheIdentityProductionRefusesToStartWithoutIsInTheDeploymentGuide()
    {
        var guide = ReadDoc("docs/deployment/aws-staging.md");

        foreach (var key in KeysOf<ComplianceOptions>(ComplianceOptions.SectionName))
        {
            Assert.Contains(key, guide, StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// One list of webhook events, in the Connect guide. A second copy in the deployment guide is
    /// how it came to say three while the endpoint handled twenty.
    /// </summary>
    [Fact]
    public void TheDeploymentGuidePointsAtTheOneListOfWebhookEvents()
    {
        Assert.Contains("docs/stripe-connect.md", ReadDoc("docs/deployment/aws-staging.md"), StringComparison.Ordinal);
    }
}
