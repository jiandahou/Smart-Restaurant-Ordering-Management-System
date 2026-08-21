using System.Reflection;
using DineFlow.Api.Controllers;
using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// An unconfirmed account used to be a dead end: sign-in was refused with prose and no way to get
/// another confirmation link, and the link itself expired without the email ever saying so.
/// </summary>
public sealed class UnconfirmedSignInTests
{
    private static string ReadAuthController()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return File.ReadAllText(Path.Combine(
            directory!.FullName, "DineFlow.Api", "Controllers", "AuthController.cs"));
    }

    [Fact]
    public void SignInRefusalCarriesAMachineReadableCode()
    {
        // The client branches on this to offer a resend; matching on the message would break the
        // moment the wording changed.
        Assert.Contains("code = \"email_not_confirmed\"", ReadAuthController(), StringComparison.Ordinal);
    }

    [Fact]
    public void NoSessionIsIssuedToAnUnconfirmedAccount()
    {
        var source = ReadAuthController();
        var start = source.IndexOf("if (!await _userManager.IsEmailConfirmedAsync(user))", StringComparison.Ordinal);
        Assert.True(start >= 0);

        var branch = source.Substring(start, 900);

        Assert.Contains("Status403Forbidden", branch, StringComparison.Ordinal);
        Assert.DoesNotContain("BuildAuthenticatedResponseAsync", branch, StringComparison.Ordinal);
    }

    [Fact]
    public void TheConfirmationEmailStatesTheExpiryFromTheConfiguredWindow()
    {
        // Hardcoding "one hour" would drift the moment the window changed.
        Assert.Contains(
            "DescribeDuration(UnconfirmedCustomerCleanupService.ConfirmationWindow)",
            ReadAuthController(),
            StringComparison.Ordinal);
    }

    [Fact]
    public void TheConfirmationEmailSaysWhatHappensAfterExpiry()
    {
        // Promising a resend that stops working once the account is swept away is worse than
        // saying nothing.
        var source = ReadAuthController();

        Assert.Contains("removed automatically", source, StringComparison.Ordinal);
        Assert.Contains("sign up again", source, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(1, "one hour")]
    [InlineData(24, "24 hours")]
    public void DurationsReadAsEnglish(int hours, string expected)
    {
        var method = typeof(AuthController).GetMethod(
            "DescribeDuration", BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        Assert.Equal(expected, method!.Invoke(null, [TimeSpan.FromHours(hours)]));
    }

    [Fact]
    public void ShortWindowsAreDescribedInMinutes()
    {
        var method = typeof(AuthController).GetMethod(
            "DescribeDuration", BindingFlags.NonPublic | BindingFlags.Static);

        Assert.Equal("30 minutes", method!.Invoke(null, [TimeSpan.FromMinutes(30)]));
        Assert.Equal("1 minute", method!.Invoke(null, [TimeSpan.FromMinutes(1)]));
    }

    [Fact]
    public void TheConfirmationLinkAndTheAccountExpireTogether()
    {
        // Two different clocks would mean a link that still works on an account that is gone.
        Assert.Equal(
            UnconfirmedCustomerCleanupService.ConfirmationWindow,
            new EmailConfirmationTokenProviderOptions().TokenLifespan);
    }

    [Fact]
    public void ExtendingConfirmationDoesNotExtendPasswordResetsOrMagicLinks()
    {
        // Those come from the default provider. Sharing one lifespan means a 24-hour confirmation
        // window would silently hand out 24-hour password reset links too.
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        var program = File.ReadAllText(Path.Combine(directory!.FullName, "DineFlow.Api", "Program.cs"));

        Assert.Contains("options.TokenLifespan = TimeSpan.FromHours(1);", program, StringComparison.Ordinal);
        Assert.Contains(
            "options.Tokens.EmailConfirmationTokenProvider = EmailConfirmationTokenProviderOptions.ProviderName",
            program,
            StringComparison.Ordinal);
        Assert.True(
            new EmailConfirmationTokenProviderOptions().TokenLifespan > TimeSpan.FromHours(1),
            "Confirmation should outlive the shared one-hour token lifespan.");
    }
}
