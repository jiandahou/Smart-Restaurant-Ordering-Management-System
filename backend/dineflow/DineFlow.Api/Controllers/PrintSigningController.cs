using System.Text;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Print;
using DineFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DineFlow.Api.Controllers;

/// <summary>
/// Backs the QZ Tray trust chain: serves the deployment's signing certificate and
/// signs individual QZ requests server-side, so the private key never reaches the
/// browser and print requests stop being "anonymous" in QZ Tray's security prompt.
/// </summary>
[ApiController]
[Route("api/print")]
public class PrintSigningController : ControllerBase
{
    private const int MaximumSignPayloadLength = 20_000;

    private readonly IConfiguration _configuration;
    private readonly ILogger<PrintSigningController> _logger;

    public PrintSigningController(IConfiguration configuration, ILogger<PrintSigningController> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    [AllowAnonymous]
    [HttpGet("certificate")]
    public IActionResult GetCertificate()
    {
        var certificatePem = ReadPemFromConfiguration("QzPrint:CertificatePemBase64", "QZ_CERT_PEM_B64");

        if (certificatePem is null)
        {
            return NotFound(new { message = "QZ signing certificate is not configured." });
        }

        return Content(certificatePem, "text/plain", Encoding.UTF8);
    }

    [Authorize(Policy = AuthorizationPolicies.StaffApi)]
    [HttpPost("sign")]
    public IActionResult SignRequest([FromBody] SignPrintRequestRequest? request)
    {
        var payload = request?.Request;

        if (string.IsNullOrWhiteSpace(payload))
        {
            return BadRequest(new { message = "Request payload is required." });
        }

        if (payload.Length > MaximumSignPayloadLength)
        {
            return BadRequest(new { message = $"Request payload cannot exceed {MaximumSignPayloadLength} characters." });
        }

        var privateKeyPem = ReadPemFromConfiguration("QzPrint:PrivateKeyPemBase64", "QZ_PRIVATE_KEY_PEM_B64");

        if (privateKeyPem is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "QZ signing key is not configured."
            });
        }

        try
        {
            return Ok(new { signature = QzRequestSigner.Sign(privateKeyPem, payload) });
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to sign QZ Tray print request.");
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                message = "The print request could not be signed."
            });
        }
    }

    private string? ReadPemFromConfiguration(params string[] keys)
    {
        foreach (var key in keys)
        {
            var value = _configuration[key];

            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            try
            {
                return Encoding.UTF8.GetString(Convert.FromBase64String(value));
            }
            catch (FormatException)
            {
                // Value is stored as raw PEM rather than base64 — use it as-is.
                return value;
            }
        }

        return null;
    }
}
