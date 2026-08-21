using System.Text;
using System.Text.Encodings.Web;
using DineFlow.Api.Options;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

/// <summary>What a transactional email says, independent of how it is laid out.</summary>
public sealed record TransactionalEmail(
    string Heading,
    IReadOnlyList<string> Paragraphs,
    string? ActionLabel = null,
    string? ActionUrl = null,
    /// <summary>Smaller print under the action — expiry, what to do if this was unexpected.</summary>
    IReadOnlyList<string>? Footnotes = null);

/// <summary>
/// One shell for every transactional email.
///
/// <para>
/// The messages used to be bare <c>&lt;p&gt;</c> tags, which mail clients render as unstyled
/// default text — no sender identity, no way to tell a real DineFlow email from a phishing
/// attempt, and nothing to fall back on when a client strips the link.
/// </para>
///
/// <para>
/// Written as tables with inline styles because that is what mail clients reliably support;
/// stylesheets and modern layout are widely stripped. The footer carries the operator's legal
/// identity, which is both what makes the mail look like it comes from a real business and what
/// an Australian recipient needs in order to identify who contacted them.
/// </para>
/// </summary>
public sealed class TransactionalEmailLayout(IOptions<ComplianceOptions> complianceOptions)
{
    private readonly ComplianceOptions _compliance = complianceOptions.Value;

    private string OperatorName =>
        string.IsNullOrWhiteSpace(_compliance.OperatorName) ? "DineFlow" : _compliance.OperatorName.Trim();

    public string RenderHtml(TransactionalEmail email)
    {
        var encode = HtmlEncoder.Default;
        var builder = new StringBuilder();

        builder.Append(
            """
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:#f4f4f5;padding:24px 12px;">
              <tr><td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;
                              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                              color:#18181b;">
            """);

        builder.Append($"""
              <tr><td style="padding:24px 28px 0;border-bottom:1px solid #f4f4f5;">
                <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.08em;
                          text-transform:uppercase;color:#71717a;">{encode.Encode(OperatorName)}</p>
              </td></tr>
              <tr><td style="padding:24px 28px 0;">
                <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;">{encode.Encode(email.Heading)}</h1>
            """);

        foreach (var paragraph in email.Paragraphs)
        {
            builder.Append(
                $"""<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">{encode.Encode(paragraph)}</p>""");
        }

        builder.Append("</td></tr>");

        if (!string.IsNullOrWhiteSpace(email.ActionUrl) && !string.IsNullOrWhiteSpace(email.ActionLabel))
        {
            var url = encode.Encode(email.ActionUrl);

            builder.Append($"""
              <tr><td style="padding:8px 28px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td style="background:#18181b;border-radius:8px;">
                    <a href="{url}" style="display:inline-block;padding:12px 22px;font-size:15px;
                       font-weight:600;color:#ffffff;text-decoration:none;">{encode.Encode(email.ActionLabel)}</a>
                  </td></tr>
                </table>
              </td></tr>
              <tr><td style="padding:12px 28px 0;">
                <p style="margin:0 0 6px;font-size:13px;color:#71717a;">
                  If the button does not work, copy this address into your browser:
                </p>
                <p style="margin:0;font-size:13px;word-break:break-all;">
                  <a href="{url}" style="color:#3f3f46;">{url}</a>
                </p>
              </td></tr>
            """);
        }

        if (email.Footnotes is { Count: > 0 })
        {
            builder.Append("""<tr><td style="padding:16px 28px 0;">""");
            foreach (var footnote in email.Footnotes)
            {
                builder.Append(
                    $"""<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#52525b;">{encode.Encode(footnote)}</p>""");
            }
            builder.Append("</td></tr>");
        }

        builder.Append($"""
              <tr><td style="padding:20px 28px 24px;margin-top:8px;border-top:1px solid #f4f4f5;">
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#71717a;">
                  {encode.Encode(BuildFooterIdentity())}
                </p>
                <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#a1a1aa;">
                  This is an automated message from DineFlow. Please do not reply to it.
                </p>
              </td></tr>
                </table>
              </td></tr>
            </table>
            """);

        return builder.ToString();
    }

    /// <summary>
    /// The same message as plain text. Not an afterthought: some clients show only this, some
    /// recipients prefer it, and spam filters treat an HTML-only message with suspicion.
    /// </summary>
    public string RenderText(TransactionalEmail email)
    {
        var lines = new List<string> { email.Heading, string.Empty };
        lines.AddRange(email.Paragraphs);

        if (!string.IsNullOrWhiteSpace(email.ActionUrl))
        {
            lines.Add(string.Empty);
            lines.Add(string.IsNullOrWhiteSpace(email.ActionLabel)
                ? email.ActionUrl
                : $"{email.ActionLabel}: {email.ActionUrl}");
        }

        if (email.Footnotes is { Count: > 0 })
        {
            lines.Add(string.Empty);
            lines.AddRange(email.Footnotes);
        }

        lines.Add(string.Empty);
        lines.Add(BuildFooterIdentity());
        lines.Add("This is an automated message from DineFlow. Please do not reply to it.");

        return string.Join("\n", lines);
    }

    /// <summary>
    /// Who sent this, in the terms a recipient can act on. Anything the operator has not configured
    /// is left out rather than printed as an empty label — see the Compliance settings.
    /// </summary>
    private string BuildFooterIdentity()
    {
        var parts = new List<string> { OperatorName };

        if (!string.IsNullOrWhiteSpace(_compliance.OperatorAbn))
        {
            parts.Add($"ABN {_compliance.OperatorAbn.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(_compliance.OperatorAddress))
        {
            parts.Add(_compliance.OperatorAddress.Trim());
        }

        if (!string.IsNullOrWhiteSpace(_compliance.SupportEmail))
        {
            parts.Add($"Support: {_compliance.SupportEmail.Trim()}");
        }

        return string.Join(" · ", parts);
    }
}
