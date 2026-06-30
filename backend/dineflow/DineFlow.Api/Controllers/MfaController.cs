using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Api.Services;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OtpNet;

namespace DineFlow.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/auth/mfa")]
public sealed class MfaController : ControllerBase
{
    private const string Issuer = "DineFlow";
    private const int TotpSecretBytes = 20;
    private const int TotpDigits = 6;
    private const int TotpPeriodSeconds = 30;

    private readonly AppDbContext _dbContext;
    private readonly IEmailSender _emailSender;
    private readonly IMfaEmailSetupCodeStore _emailSetupCodeStore;
    private readonly IJwtTokenService _jwtTokenService;
    private readonly IMfaLoginChallengeStore _loginChallengeStore;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly ReportLogWriter _reportLogWriter;

    public MfaController(
        AppDbContext dbContext,
        IEmailSender emailSender,
        IMfaEmailSetupCodeStore emailSetupCodeStore,
        IJwtTokenService jwtTokenService,
        IMfaLoginChallengeStore loginChallengeStore,
        UserManager<ApplicationUser> userManager,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _emailSender = emailSender;
        _emailSetupCodeStore = emailSetupCodeStore;
        _jwtTokenService = jwtTokenService;
        _loginChallengeStore = loginChallengeStore;
        _userManager = userManager;
        _reportLogWriter = reportLogWriter;
    }

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings(CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ToSettingsResponse(settings));
    }

    [HttpPut("settings")]
    public async Task<IActionResult> UpdateSettings(
        UpdateMfaSettingsRequest request,
        CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);
        var beforeSettings = SnapshotSettings(settings);

        settings.RequireForLogin = request.RequireForLogin;
        settings.RequireForPayment = request.RequireForPayment;
        settings.RequireForSensitiveActions = request.RequireForSensitiveActions;
        settings.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "Auth.MfaSettingsUpdated",
            "User",
            user.Id,
            user.RestaurantId,
            $"MFA settings updated for {user.Email}.",
            beforeSettings,
            SnapshotSettings(settings));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "MFA settings updated.",
            settings = ToSettingsResponse(settings)
        });
    }

    [HttpPost("sensitive/email-code")]
    public async Task<IActionResult> SendSensitiveActionEmailCode(CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);

        if (!settings.EmailEnabled)
        {
            return BadRequest(new
            {
                message = "Email MFA is not enabled."
            });
        }

        var code = GenerateSixDigitCode();
        _emailSetupCodeStore.Store(user.Id, code);
        await SendSensitiveActionCodeAsync(user, code, cancellationToken);

        return Ok(new
        {
            message = "Sensitive action code sent."
        });
    }

    [HttpPost("totp/setup")]
    public async Task<IActionResult> SetupTotp(CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);
        var secretBytes = KeyGeneration.GenerateRandomKey(TotpSecretBytes);
        var secret = Base32Encoding.ToString(secretBytes);

        settings.TotpSecret = secret;
        settings.UpdatedAt = DateTime.UtcNow;

        _reportLogWriter.AddAudit(
            "Auth.MfaTotpSetupStarted",
            "User",
            user.Id,
            user.RestaurantId,
            $"TOTP MFA setup started for {user.Email}.",
            after: SnapshotSettings(settings));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "TOTP setup started.",
            secret,
            otpauthUri = BuildOtpAuthUri(user, secret),
            digits = TotpDigits,
            period = TotpPeriodSeconds
        });
    }

    [HttpPost("totp/enable")]
    public async Task<IActionResult> EnableTotp(
        EnableTotpMfaRequest request,
        CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);

        if (string.IsNullOrWhiteSpace(settings.TotpSecret))
        {
            return BadRequest(new
            {
                message = "Start TOTP setup before enabling it."
            });
        }

        if (!IsValidTotpCode(settings.TotpSecret, request.Code))
        {
            return BadRequest(new
            {
                message = "TOTP code is invalid or expired."
            });
        }

        var beforeSettings = SnapshotSettings(settings);

        settings.TotpEnabled = true;
        settings.PreferredMethod = MfaMethods.Totp;

        if (!settings.RequireForLogin && !settings.RequireForPayment && !settings.RequireForSensitiveActions)
        {
            settings.RequireForLogin = true;
        }

        settings.UpdatedAt = DateTime.UtcNow;
        user.TwoFactorEnabled = true;
        user.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        var updateResult = await _userManager.UpdateAsync(user);

        if (!updateResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to enable MFA.",
                errors = updateResult.Errors
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.MfaTotpEnabled",
            "User",
            user.Id,
            user.RestaurantId,
            $"TOTP MFA enabled for {user.Email}.",
            beforeSettings,
            SnapshotSettings(settings));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "TOTP MFA enabled.",
            settings = ToSettingsResponse(settings)
        });
    }

    [HttpPost("email/setup")]
    public async Task<IActionResult> SetupEmail(CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        if (string.IsNullOrWhiteSpace(user.Email) || !await _userManager.IsEmailConfirmedAsync(user))
        {
            return BadRequest(new
            {
                message = "Confirm an email address before enabling email MFA."
            });
        }

        var code = GenerateSixDigitCode();
        _emailSetupCodeStore.Store(user.Id, code);
        await SendEmailMfaSetupCodeAsync(user, code, cancellationToken);

        return Ok(new
        {
            message = "Email MFA code sent."
        });
    }

    [HttpPost("email/enable")]
    public async Task<IActionResult> EnableEmail(
        EnableEmailMfaRequest request,
        CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var normalizedCode = NormalizeCode(request.Code);

        if (!_emailSetupCodeStore.TryConsume(user.Id, normalizedCode))
        {
            return BadRequest(new
            {
                message = "Email MFA code is invalid or expired."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);
        var beforeSettings = SnapshotSettings(settings);

        settings.EmailEnabled = true;

        if (!settings.TotpEnabled)
        {
            settings.PreferredMethod = MfaMethods.Email;
        }

        if (!settings.RequireForLogin && !settings.RequireForPayment && !settings.RequireForSensitiveActions)
        {
            settings.RequireForLogin = true;
        }

        settings.UpdatedAt = DateTime.UtcNow;
        user.TwoFactorEnabled = true;
        user.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        var updateResult = await _userManager.UpdateAsync(user);

        if (!updateResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to enable email MFA.",
                errors = updateResult.Errors
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.MfaEmailEnabled",
            "User",
            user.Id,
            user.RestaurantId,
            $"Email MFA enabled for {user.Email}.",
            beforeSettings,
            SnapshotSettings(settings));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Email MFA enabled.",
            settings = ToSettingsResponse(settings)
        });
    }

    [HttpPost("disable")]
    public async Task<IActionResult> DisableMfa(
        DisableMfaRequest request,
        CancellationToken cancellationToken)
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var settings = await GetOrCreateSettingsAsync(user.Id, cancellationToken);
        var method = request.Method.Trim().ToLowerInvariant();
        var beforeSettings = SnapshotSettings(settings);

        if ((settings.TotpEnabled || settings.EmailEnabled) &&
            !ValidateMfaVerification(settings, user.Id, request.Verification))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to disable MFA."
            });
        }

        switch (method)
        {
            case MfaMethods.Totp:
                settings.TotpEnabled = false;
                settings.TotpSecret = null;
                break;
            case MfaMethods.Email:
                settings.EmailEnabled = false;
                break;
            case "all":
                settings.TotpEnabled = false;
                settings.TotpSecret = null;
                settings.EmailEnabled = false;
                settings.RequireForLogin = false;
                settings.RequireForPayment = false;
                settings.RequireForSensitiveActions = false;
                break;
            default:
                return BadRequest(new
                {
                    message = "Invalid MFA method."
                });
        }

        if (!settings.TotpEnabled && !settings.EmailEnabled)
        {
            settings.PreferredMethod = MfaMethods.Totp;
            settings.RequireForLogin = false;
            settings.RequireForPayment = false;
            settings.RequireForSensitiveActions = false;
            user.TwoFactorEnabled = false;
        }
        else if (settings.PreferredMethod == MfaMethods.Totp && !settings.TotpEnabled)
        {
            settings.PreferredMethod = MfaMethods.Email;
        }
        else if (settings.PreferredMethod == MfaMethods.Email && !settings.EmailEnabled)
        {
            settings.PreferredMethod = MfaMethods.Totp;
        }

        settings.UpdatedAt = DateTime.UtcNow;
        user.UpdatedAt = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        var updateResult = await _userManager.UpdateAsync(user);

        if (!updateResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to disable MFA.",
                errors = updateResult.Errors
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.MfaDisabled",
            "User",
            user.Id,
            user.RestaurantId,
            method == "all" ? $"MFA disabled for {user.Email}." : $"{method.ToUpperInvariant()} MFA disabled for {user.Email}.",
            beforeSettings,
            SnapshotSettings(settings));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = method == "all" ? "MFA disabled." : $"{method.ToUpperInvariant()} MFA disabled.",
            settings = ToSettingsResponse(settings)
        });
    }

    [AllowAnonymous]
    [HttpPost("login/verify")]
    public async Task<IActionResult> VerifyLogin(
        VerifyMfaLoginRequest request,
        CancellationToken cancellationToken)
    {
        if (!_loginChallengeStore.TryGet(request.ChallengeId, out var challenge))
        {
            return BadRequest(new
            {
                message = "MFA challenge is invalid or expired."
            });
        }

        var method = request.Method.Trim().ToLowerInvariant();

        if (!challenge.Methods.Contains(method, StringComparer.OrdinalIgnoreCase))
        {
            return BadRequest(new
            {
                message = "MFA method is not available for this challenge."
            });
        }

        var user = await _userManager.FindByIdAsync(challenge.UserId);

        if (user is null || !await _userManager.IsEmailConfirmedAsync(user))
        {
            return BadRequest(new
            {
                message = "MFA challenge is invalid."
            });
        }

        var settings = await _dbContext.UserMfaSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(mfaSettings => mfaSettings.UserId == user.Id, cancellationToken);

        if (settings is null || !settings.RequireForLogin)
        {
            return BadRequest(new
            {
                message = "MFA is not required for this account."
            });
        }

        var normalizedCode = NormalizeCode(request.Code);
        var isValid = method switch
        {
            MfaMethods.Totp => settings.TotpEnabled &&
                !string.IsNullOrWhiteSpace(settings.TotpSecret) &&
                IsValidTotpCode(settings.TotpSecret, normalizedCode),
            MfaMethods.Email => settings.EmailEnabled &&
                !string.IsNullOrWhiteSpace(challenge.EmailCode) &&
                string.Equals(challenge.EmailCode, normalizedCode, StringComparison.Ordinal),
            _ => false
        };

        if (!isValid)
        {
            return BadRequest(new
            {
                message = "MFA code is invalid or expired."
            });
        }

        _loginChallengeStore.TryConsume(request.ChallengeId, out _);

        return await BuildAuthenticatedResponseAsync(user, "MFA verification successful.");
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        return string.IsNullOrWhiteSpace(currentUserId)
            ? null
            : await _userManager.FindByIdAsync(currentUserId);
    }

    private async Task<UserMfaSettings> GetOrCreateSettingsAsync(
        string userId,
        CancellationToken cancellationToken)
    {
        var settings = await _dbContext.UserMfaSettings
            .FirstOrDefaultAsync(mfaSettings => mfaSettings.UserId == userId, cancellationToken);

        if (settings is not null)
        {
            return settings;
        }

        settings = new UserMfaSettings
        {
            UserId = userId,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.UserMfaSettings.Add(settings);

        return settings;
    }

    private static object ToSettingsResponse(UserMfaSettings settings)
    {
        var enabledMethods = new List<string>();

        if (settings.TotpEnabled)
        {
            enabledMethods.Add(MfaMethods.Totp);
        }

        if (settings.EmailEnabled)
        {
            enabledMethods.Add(MfaMethods.Email);
        }

        return new
        {
            enabled = settings.TotpEnabled || settings.EmailEnabled,
            methods = enabledMethods,
            preferredMethod = settings.PreferredMethod,
            requiredFor = new
            {
                login = settings.RequireForLogin,
                payment = settings.RequireForPayment,
                sensitiveActions = settings.RequireForSensitiveActions
            },
            totp = new
            {
                enabled = settings.TotpEnabled,
                setupStarted = !string.IsNullOrWhiteSpace(settings.TotpSecret)
            },
            email = new
            {
                enabled = settings.EmailEnabled
            }
        };
    }

    private static string BuildOtpAuthUri(ApplicationUser user, string secret)
    {
        var accountName = user.Email ?? user.UserName ?? user.Id;
        var label = Uri.EscapeDataString($"{Issuer}:{accountName}");
        var issuer = Uri.EscapeDataString(Issuer);

        return $"otpauth://totp/{label}?secret={secret}&issuer={issuer}&digits={TotpDigits}&period={TotpPeriodSeconds}&algorithm=SHA1";
    }

    private static bool IsValidTotpCode(string secret, string code)
    {
        var normalizedCode = NormalizeCode(code);

        if (normalizedCode.Length != TotpDigits)
        {
            return false;
        }

        var secretBytes = Base32Encoding.ToBytes(secret);
        var totp = new Totp(secretBytes, step: TotpPeriodSeconds, totpSize: TotpDigits);

        return totp.VerifyTotp(
            normalizedCode,
            out _,
            VerificationWindow.RfcSpecifiedNetworkDelay);
    }

    private bool ValidateMfaVerification(
        UserMfaSettings settings,
        string userId,
        MfaVerificationRequest? verification)
    {
        if (verification is null)
        {
            return false;
        }

        var method = verification.Method.Trim().ToLowerInvariant();
        var normalizedCode = NormalizeCode(verification.Code);

        return method switch
        {
            MfaMethods.Totp => settings.TotpEnabled &&
                !string.IsNullOrWhiteSpace(settings.TotpSecret) &&
                IsValidTotpCode(settings.TotpSecret, normalizedCode),
            MfaMethods.Email => settings.EmailEnabled &&
                _emailSetupCodeStore.TryConsume(userId, normalizedCode),
            _ => false
        };
    }

    private async Task SendEmailMfaSetupCodeAsync(
        ApplicationUser user,
        string code,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send an MFA code.");
        }

        await _emailSender.SendAsync(
            user.Email,
            "Enable DineFlow email MFA",
            $"""
            <p>Use this code to enable email MFA for your DineFlow account.</p>
            <p><strong style="font-size: 24px; letter-spacing: 0.2em;">{HtmlEncoder.Default.Encode(code)}</strong></p>
            <p>This code expires in ten minutes.</p>
            """,
            $"Use this code to enable DineFlow email MFA: {code}. It expires in ten minutes.",
            cancellationToken);
    }

    private async Task SendSensitiveActionCodeAsync(
        ApplicationUser user,
        string code,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send an MFA code.");
        }

        await _emailSender.SendAsync(
            user.Email,
            "Your DineFlow sensitive action code",
            $"""
            <p>Use this code to confirm a sensitive DineFlow account action.</p>
            <p><strong style="font-size: 24px; letter-spacing: 0.2em;">{HtmlEncoder.Default.Encode(code)}</strong></p>
            <p>This code expires in ten minutes.</p>
            """,
            $"Your DineFlow sensitive action code is {code}. It expires in ten minutes.",
            cancellationToken);
    }

    private async Task<IActionResult> BuildAuthenticatedResponseAsync(ApplicationUser user, string message)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var token = _jwtTokenService.GenerateToken(
            user.Id,
            user.Email,
            user.UserName,
            roles);

        _reportLogWriter.AddAudit(
            "Auth.MfaLoginSucceeded",
            "User",
            user.Id,
            user.RestaurantId,
            message,
            after: new
            {
                user.Email,
                user.RestaurantId,
                Roles = roles.OrderBy(role => role, StringComparer.OrdinalIgnoreCase).ToArray()
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message,
            token,
            user = new
            {
                id = user.Id,
                email = user.Email,
                fullName = user.FullName,
                avatarUrl = user.AvatarUrl,
                restaurantId = user.RestaurantId,
                roles
            }
        });
    }

    private static object SnapshotSettings(UserMfaSettings settings) => new
    {
        settings.UserId,
        settings.TotpEnabled,
        TotpSetupStarted = !string.IsNullOrWhiteSpace(settings.TotpSecret),
        settings.EmailEnabled,
        settings.PreferredMethod,
        settings.RequireForLogin,
        settings.RequireForPayment,
        settings.RequireForSensitiveActions
    };

    private static string GenerateSixDigitCode()
    {
        return RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
    }

    private static string NormalizeCode(string? code)
    {
        return new string((code ?? string.Empty).Where(char.IsDigit).ToArray());
    }
}
