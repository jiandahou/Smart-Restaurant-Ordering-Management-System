using DineFlow.Api.Options;
using DineFlow.Api.Services;
using Microsoft.Extensions.Options;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The transactional emails were bare paragraph tags: no sender identity, nothing to distinguish
/// them from a phishing attempt, and no fallback when a client strips the link. These assert the
/// parts a recipient actually depends on.
/// </summary>
public sealed class TransactionalEmailLayoutTests
{
    private static TransactionalEmailLayout CreateLayout(ComplianceOptions? compliance = null) =>
        new(Options.Create(compliance ?? new ComplianceOptions
        {
            OperatorName = "DineFlow Pty Ltd",
            OperatorAbn = "51824753556",
            OperatorAddress = "10 King William Street, Adelaide SA 5000",
            SupportEmail = "support@dineflow.example",
        }));

    private static readonly TransactionalEmail Sample = new(
        Heading: "Confirm your email address",
        Paragraphs: ["An account was created for diner@example.com."],
        ActionLabel: "Confirm email address",
        ActionUrl: "https://app.dineflow.example/confirm?token=abc123",
        Footnotes: ["This link expires in one hour."]);

    [Fact]
    public void TheActionIsReachableAsBothAButtonAndACopyablePlainUrl()
    {
        var html = CreateLayout().RenderHtml(Sample);

        Assert.Contains("Confirm email address", html, StringComparison.Ordinal);
        // Some clients strip or rewrite buttons; the visible address is the fallback.
        Assert.Contains("If the button does not work", html, StringComparison.Ordinal);
        Assert.Contains("https://app.dineflow.example/confirm?token=abc123", html, StringComparison.Ordinal);
    }

    [Fact]
    public void TheSenderIdentifiesItselfSoTheMailCanBeTrusted()
    {
        var html = CreateLayout().RenderHtml(Sample);

        Assert.Contains("DineFlow Pty Ltd", html, StringComparison.Ordinal);
        Assert.Contains("ABN 51824753556", html, StringComparison.Ordinal);
        Assert.Contains("10 King William Street", html, StringComparison.Ordinal);
        Assert.Contains("support@dineflow.example", html, StringComparison.Ordinal);
    }

    [Fact]
    public void UnconfiguredIdentityFieldsAreOmittedRatherThanPrintedEmpty()
    {
        // Before the operator fills in Compliance settings, an empty "ABN " label would look worse
        // than saying nothing at all.
        var html = CreateLayout(new ComplianceOptions { OperatorName = "DineFlow" }).RenderHtml(Sample);

        Assert.DoesNotContain("ABN", html, StringComparison.Ordinal);
        Assert.DoesNotContain("Support:", html, StringComparison.Ordinal);
        Assert.Contains("DineFlow", html, StringComparison.Ordinal);
    }

    [Fact]
    public void FallsBackToTheProductNameWhenNoOperatorIsConfigured()
    {
        var html = CreateLayout(new ComplianceOptions()).RenderHtml(Sample);

        Assert.Contains("DineFlow", html, StringComparison.Ordinal);
    }

    [Fact]
    public void ContentIsHtmlEncodedSoAValueCannotBreakTheLayout()
    {
        var html = CreateLayout().RenderHtml(Sample with
        {
            Paragraphs = ["An account was created for <script>alert(1)</script>."],
        });

        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;", html, StringComparison.Ordinal);
    }

    [Fact]
    public void UsesTablesAndInlineStylesBecauseMailClientsStripStylesheets()
    {
        var html = CreateLayout().RenderHtml(Sample);

        Assert.Contains("<table", html, StringComparison.Ordinal);
        Assert.Contains("style=", html, StringComparison.Ordinal);
        Assert.DoesNotContain("<style", html, StringComparison.Ordinal);
    }

    [Fact]
    public void ThePlainTextAlternativeCarriesEverythingTheHtmlDoes()
    {
        // Some clients show only this, and an HTML-only message looks like spam.
        var text = CreateLayout().RenderText(Sample);

        Assert.Contains("Confirm your email address", text, StringComparison.Ordinal);
        Assert.Contains("An account was created for diner@example.com.", text, StringComparison.Ordinal);
        Assert.Contains("https://app.dineflow.example/confirm?token=abc123", text, StringComparison.Ordinal);
        Assert.Contains("This link expires in one hour.", text, StringComparison.Ordinal);
        Assert.Contains("DineFlow Pty Ltd", text, StringComparison.Ordinal);
    }

    [Fact]
    public void AMessageWithNoActionRendersWithoutAButton()
    {
        // The MFA code email has a code, not a link.
        var html = CreateLayout().RenderHtml(new TransactionalEmail(
            Heading: "Your verification code",
            Paragraphs: ["Use this code to finish signing in:", "482913"]));

        Assert.Contains("482913", html, StringComparison.Ordinal);
        Assert.DoesNotContain("If the button does not work", html, StringComparison.Ordinal);
    }
}
