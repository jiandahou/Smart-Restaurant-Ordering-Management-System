using System.Net.Http.Headers;
using System.Net.Http.Json;
using DineFlow.Api.Options;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

public sealed class ResendEmailSender : IEmailSender
{
    private const string ResendEmailsEndpoint = "https://api.resend.com/emails";

    private readonly HttpClient _httpClient;
    private readonly EmailOptions _options;
    private readonly ILogger<ResendEmailSender> _logger;

    public ResendEmailSender(
        HttpClient httpClient,
        IOptions<EmailOptions> options,
        ILogger<ResendEmailSender> logger)
    {
        _httpClient = httpClient;
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

        if (string.IsNullOrWhiteSpace(_options.ResendApiKey))
        {
            throw new InvalidOperationException("Resend API key is not configured. Set RESEND_API_KEY.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, ResendEmailsEndpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ResendApiKey);
        request.Content = JsonContent.Create(new
        {
            from = _options.From,
            to = new[] { to },
            subject,
            html = htmlBody,
            text = textBody
        });

        using var response = await _httpClient.SendAsync(request, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(
                $"Resend email request failed with HTTP {(int)response.StatusCode}: {errorBody}");
        }

        _logger.LogInformation("Email sent to {Recipient} with subject {Subject}.", to, subject);
    }
}
