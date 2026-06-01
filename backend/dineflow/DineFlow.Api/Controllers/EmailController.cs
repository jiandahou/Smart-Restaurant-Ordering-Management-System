using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Email;
using DineFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/email")]
[Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
public class EmailController : ControllerBase
{
    private readonly IEmailSender _emailSender;
    private readonly ILogger<EmailController> _logger;

    public EmailController(IEmailSender emailSender, ILogger<EmailController> logger)
    {
        _emailSender = emailSender;
        _logger = logger;
    }

    [HttpPost("test")]
    public async Task<IActionResult> SendTestEmail(SendTestEmailRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.To))
        {
            return BadRequest(new
            {
                message = "Recipient email is required."
            });
        }

        var subject = string.IsNullOrWhiteSpace(request.Subject)
            ? "DineFlow email test"
            : request.Subject.Trim();
        var message = string.IsNullOrWhiteSpace(request.Message)
            ? "Your DineFlow email configuration is working."
            : request.Message.Trim();

        try
        {
            await _emailSender.SendAsync(
                request.To.Trim(),
                subject,
                $"<p>{System.Net.WebUtility.HtmlEncode(message)}</p>",
                message,
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send test email to {Recipient}.", request.To);

            return BadRequest(new
            {
                message = "Failed to send test email.",
                detail = ex.Message
            });
        }

        return Ok(new
        {
            message = "Test email sent."
        });
    }
}
