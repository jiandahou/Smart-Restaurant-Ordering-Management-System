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
    private readonly TransactionalEmailLayout _emailLayout;

    public EmailController(
        IEmailSender emailSender,
        ILogger<EmailController> logger,
        TransactionalEmailLayout emailLayout)
    {
        _emailSender = emailSender;
        _logger = logger;
        _emailLayout = emailLayout;
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
            // Rendered through the real layout: a test that looks nothing like the mail we actually
            // send proves delivery but not that the message arrives intact and readable.
            var email = new TransactionalEmail(Heading: subject, Paragraphs: [message]);

            await _emailSender.SendAsync(
                request.To.Trim(),
                subject,
                _emailLayout.RenderHtml(email),
                _emailLayout.RenderText(email),
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
