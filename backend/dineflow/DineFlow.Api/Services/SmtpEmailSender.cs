using System.Net;
using System.Net.Mail;
using DineFlow.Api.Options;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

public sealed class SmtpEmailSender : IEmailSender
{
    private readonly EmailOptions _options;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task SendAsync(
        string to,
        string subject,
        string htmlBody,
        string? textBody = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(_options.From))
        {
            throw new InvalidOperationException("Email sender is not configured. Set Email:From or AUTH_EMAIL_FROM.");
        }

        if (string.IsNullOrWhiteSpace(_options.Server))
        {
            throw new InvalidOperationException("Email SMTP server is not configured. Set Email:Server or EMAIL_SERVER.");
        }

        var smtpSettings = ParseServer(_options.Server, _options.ResendApiKey);

        using var message = new MailMessage
        {
            From = new MailAddress(_options.From),
            Subject = subject,
            Body = htmlBody,
            IsBodyHtml = true
        };
        message.To.Add(to);

        if (!string.IsNullOrWhiteSpace(textBody))
        {
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(textBody, null, "text/plain"));
            message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, null, "text/html"));
        }

        using var client = new SmtpClient(smtpSettings.Host, smtpSettings.Port)
        {
            EnableSsl = smtpSettings.EnableSsl
        };

        if (!string.IsNullOrWhiteSpace(smtpSettings.UserName))
        {
            client.Credentials = new NetworkCredential(smtpSettings.UserName, smtpSettings.Password);
        }

        await client.SendMailAsync(message, cancellationToken);
        _logger.LogInformation("Email sent to {Recipient} with subject {Subject}.", to, subject);
    }

    private static SmtpSettings ParseServer(string server, string? resendApiKey)
    {
        if (!Uri.TryCreate(server, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException("Email server must be a valid SMTP URI.");
        }

        var scheme = uri.Scheme.ToLowerInvariant();

        if (scheme is not ("smtp" or "smtps"))
        {
            throw new InvalidOperationException("Email server URI must use smtp:// or smtps://.");
        }

        var userName = string.Empty;
        var password = string.Empty;

        if (!string.IsNullOrWhiteSpace(uri.UserInfo))
        {
            var userInfo = uri.UserInfo.Split(':', 2);
            userName = Uri.UnescapeDataString(userInfo[0]);
            password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : string.Empty;
        }

        if (string.IsNullOrWhiteSpace(password) && !string.IsNullOrWhiteSpace(resendApiKey))
        {
            userName = string.IsNullOrWhiteSpace(userName) ? "resend" : userName;
            password = resendApiKey;
        }

        var port = uri.Port > 0
            ? uri.Port
            : scheme == "smtps"
                ? 465
                : 587;

        return new SmtpSettings(
            uri.Host,
            port,
            scheme == "smtps" || port is 465 or 587,
            userName,
            password);
    }

    private sealed record SmtpSettings(
        string Host,
        int Port,
        bool EnableSsl,
        string UserName,
        string Password);
}
