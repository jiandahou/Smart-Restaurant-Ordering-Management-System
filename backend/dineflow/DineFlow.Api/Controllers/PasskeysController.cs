using System.Security.Claims;
using System.Text;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Api.Services;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Fido2NetLib;
using Fido2NetLib.Objects;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/auth/passkeys")]
public sealed class PasskeysController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly Fido2 _fido2;
    private readonly IJwtTokenService _jwtTokenService;
    private readonly IMfaEmailSetupCodeStore _mfaEmailCodeStore;
    private readonly IPasskeyAssertionOptionsStore _assertionOptionsStore;
    private readonly IPasskeyRegistrationOptionsStore _registrationOptionsStore;
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly ReportLogWriter _reportLogWriter;

    public PasskeysController(
        AppDbContext dbContext,
        Fido2 fido2,
        IJwtTokenService jwtTokenService,
        IMfaEmailSetupCodeStore mfaEmailCodeStore,
        IPasskeyAssertionOptionsStore assertionOptionsStore,
        IPasskeyRegistrationOptionsStore registrationOptionsStore,
        UserManager<ApplicationUser> userManager,
        ReportLogWriter reportLogWriter)
    {
        _dbContext = dbContext;
        _fido2 = fido2;
        _jwtTokenService = jwtTokenService;
        _mfaEmailCodeStore = mfaEmailCodeStore;
        _assertionOptionsStore = assertionOptionsStore;
        _registrationOptionsStore = registrationOptionsStore;
        _userManager = userManager;
        _reportLogWriter = reportLogWriter;
    }

    [Authorize]
    [HttpGet]
    public async Task<IActionResult> ListPasskeys()
    {
        var user = await GetCurrentUserAsync();

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var passkeys = await _dbContext.UserPasskeys
            .Where(passkey => passkey.UserId == user.Id)
            .OrderByDescending(passkey => passkey.CreatedAt)
            .Select(passkey => new
            {
                id = passkey.Id,
                deviceName = passkey.DeviceName,
                credentialType = passkey.CredentialType,
                transports = passkey.Transports,
                isBackedUp = passkey.IsBackedUp,
                createdAt = passkey.CreatedAt,
                lastUsedAt = passkey.LastUsedAt
            })
            .ToListAsync();

        return Ok(passkeys);
    }

    [AllowAnonymous]
    [HttpPost("login/options")]
    public IActionResult LoginOptions()
    {
        var options = _fido2.GetAssertionOptions(new GetAssertionOptionsParams
        {
            AllowedCredentials = [],
            UserVerification = UserVerificationRequirement.Preferred
        });
        var challenge = WebEncoders.Base64UrlEncode(options.Challenge);

        _assertionOptionsStore.Store(challenge, options);

        return Ok(options);
    }

    [AllowAnonymous]
    [HttpPost("login/complete")]
    public async Task<IActionResult> LoginComplete(
        CompletePasskeyLoginRequest request,
        CancellationToken cancellationToken)
    {
        if (request.AssertionResponse is null)
        {
            return BadRequest(new
            {
                message = "Passkey sign-in response is required."
            });
        }

        if (!_assertionOptionsStore.TryConsume(request.Challenge, out var originalOptions))
        {
            return BadRequest(new
            {
                message = "Passkey sign-in options are missing or expired."
            });
        }

        var credentialId = request.AssertionResponse.RawId;
        var passkey = await _dbContext.UserPasskeys
            .FirstOrDefaultAsync(
                credential => credential.CredentialId == credentialId,
                cancellationToken);

        if (passkey is null)
        {
            return Unauthorized(new
            {
                message = "Passkey is not recognized."
            });
        }

        var result = await _fido2.MakeAssertionAsync(new MakeAssertionParams
        {
            AssertionResponse = request.AssertionResponse,
            OriginalOptions = originalOptions,
            StoredPublicKey = passkey.PublicKey,
            StoredSignatureCounter = (uint)passkey.SignCount,
            IsUserHandleOwnerOfCredentialIdCallback = async (args, ct) =>
            {
                var storedPasskey = await _dbContext.UserPasskeys
                    .AsNoTracking()
                    .FirstOrDefaultAsync(
                        credential => credential.CredentialId == args.CredentialId,
                        ct);

                return storedPasskey is not null &&
                    storedPasskey.UserHandle.SequenceEqual(args.UserHandle);
            }
        }, cancellationToken);

        passkey.SignCount = result.SignCount;
        passkey.IsBackedUp = result.IsBackedUp;
        passkey.LastUsedAt = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        var user = await _userManager.FindByIdAsync(passkey.UserId);

        if (user is null || !await _userManager.IsEmailConfirmedAsync(user))
        {
            return Unauthorized(new
            {
                message = "Passkey account is not available."
            });
        }

        return await BuildAuthenticatedResponseAsync(user, "Passkey sign-in successful.");
    }

    [Authorize]
    [HttpPost("register/options")]
    public async Task<IActionResult> RegisterOptions(
        BeginPasskeyRegistrationRequest? request,
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

        if (!await ValidateSensitiveActionAsync(user.Id, request?.Verification, cancellationToken))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to change passkeys."
            });
        }

        var existingCredentials = await _dbContext.UserPasskeys
            .Where(passkey => passkey.UserId == user.Id)
            .Select(passkey => new PublicKeyCredentialDescriptor(passkey.CredentialId))
            .ToListAsync(cancellationToken);

        var fidoUser = new Fido2User
        {
            Id = Encoding.UTF8.GetBytes(user.Id),
            Name = user.Email ?? user.UserName ?? user.Id,
            DisplayName = user.FullName ?? user.Email ?? user.UserName ?? "DineFlow user"
        };

        var options = _fido2.RequestNewCredential(new RequestNewCredentialParams
        {
            User = fidoUser,
            ExcludeCredentials = existingCredentials,
            AuthenticatorSelection = new AuthenticatorSelection
            {
                ResidentKey = ResidentKeyRequirement.Required,
                UserVerification = UserVerificationRequirement.Preferred
            },
            AttestationPreference = AttestationConveyancePreference.None
        });

        _registrationOptionsStore.Store(user.Id, options);

        return Ok(options);
    }

    [Authorize]
    [HttpPut("{passkeyId:guid}")]
    public async Task<IActionResult> UpdatePasskey(
        Guid passkeyId,
        UpdatePasskeyRequest request,
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

        if (!await ValidateSensitiveActionAsync(user.Id, request.Verification, cancellationToken))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to change passkeys."
            });
        }

        var passkey = await _dbContext.UserPasskeys
            .FirstOrDefaultAsync(
                credential => credential.Id == passkeyId && credential.UserId == user.Id,
                cancellationToken);

        if (passkey is null)
        {
            return NotFound(new
            {
                message = "Passkey not found."
            });
        }

        var beforePasskey = SnapshotPasskey(passkey);
        passkey.DeviceName = NormalizeDeviceName(request.DeviceName);
        _reportLogWriter.AddAudit(
            "Auth.PasskeyUpdated",
            "UserPasskey",
            passkey.Id.ToString(),
            user.RestaurantId,
            $"Passkey updated for {user.Email}.",
            beforePasskey,
            SnapshotPasskey(passkey));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Passkey updated.",
            passkey = ToPasskeyResponse(passkey)
        });
    }

    [Authorize]
    [HttpDelete("{passkeyId:guid}")]
    public async Task<IActionResult> DeletePasskey(
        Guid passkeyId,
        [FromBody] DeletePasskeyRequest? request,
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

        if (!await ValidateSensitiveActionAsync(user.Id, request?.Verification, cancellationToken))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to change passkeys."
            });
        }

        var passkey = await _dbContext.UserPasskeys
            .FirstOrDefaultAsync(
                credential => credential.Id == passkeyId && credential.UserId == user.Id,
                cancellationToken);

        if (passkey is null)
        {
            return NotFound(new
            {
                message = "Passkey not found."
            });
        }

        var deletedPasskey = SnapshotPasskey(passkey);
        _dbContext.UserPasskeys.Remove(passkey);
        _reportLogWriter.AddAudit(
            "Auth.PasskeyDeleted",
            "UserPasskey",
            passkey.Id.ToString(),
            user.RestaurantId,
            $"Passkey deleted for {user.Email}.",
            deletedPasskey);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Passkey deleted.",
            passkeyId
        });
    }

    [Authorize]
    [HttpPost("register/complete")]
    public async Task<IActionResult> RegisterComplete(
        CompletePasskeyRegistrationRequest request,
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

        if (request.AttestationResponse is null)
        {
            return BadRequest(new
            {
                message = "Passkey registration response is required."
            });
        }

        if (!_registrationOptionsStore.TryConsume(user.Id, out var originalOptions))
        {
            return BadRequest(new
            {
                message = "Passkey registration options are missing or expired."
            });
        }

        var result = await _fido2.MakeNewCredentialAsync(new MakeNewCredentialParams
        {
            AttestationResponse = request.AttestationResponse,
            OriginalOptions = originalOptions,
            IsCredentialIdUniqueToUserCallback = async (args, ct) =>
                !await _dbContext.UserPasskeys.AnyAsync(
                    passkey => passkey.CredentialId == args.CredentialId,
                    ct)
        }, cancellationToken);

        var passkey = new UserPasskey
        {
            UserId = user.Id,
            CredentialId = result.Id,
            PublicKey = result.PublicKey,
            UserHandle = Encoding.UTF8.GetBytes(user.Id),
            SignCount = result.SignCount,
            DeviceName = NormalizeDeviceName(request.DeviceName),
            CredentialType = result.Type.ToString(),
            Transports = result.Transports is null ? null : string.Join(",", result.Transports),
            AaGuid = result.AaGuid,
            IsBackedUp = result.IsBackedUp,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.UserPasskeys.Add(passkey);
        _reportLogWriter.AddAudit(
            "Auth.PasskeyRegistered",
            "UserPasskey",
            passkey.Id.ToString(),
            user.RestaurantId,
            $"Passkey registered for {user.Email}.",
            after: SnapshotPasskey(passkey));
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Passkey registered.",
            passkey = new
            {
                id = passkey.Id,
                deviceName = passkey.DeviceName,
                createdAt = passkey.CreatedAt
            }
        });
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        return string.IsNullOrWhiteSpace(currentUserId)
            ? null
            : await _userManager.FindByIdAsync(currentUserId);
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
            "Auth.PasskeyLoginSucceeded",
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

    private static object SnapshotPasskey(UserPasskey passkey) => new
    {
        passkey.Id,
        passkey.UserId,
        passkey.DeviceName,
        passkey.CredentialType,
        passkey.Transports,
        passkey.IsBackedUp,
        passkey.CreatedAt,
        passkey.LastUsedAt
    };

    private async Task<bool> ValidateSensitiveActionAsync(
        string userId,
        MfaVerificationRequest? verification,
        CancellationToken cancellationToken)
    {
        var settings = await _dbContext.UserMfaSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(
                mfaSettings => mfaSettings.UserId == userId,
                cancellationToken);

        if (settings is null || !settings.RequireForSensitiveActions)
        {
            return true;
        }

        if (!settings.TotpEnabled && !settings.EmailEnabled)
        {
            return true;
        }

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
                _mfaEmailCodeStore.TryConsume(userId, normalizedCode),
            _ => false
        };
    }

    private static object ToPasskeyResponse(UserPasskey passkey)
    {
        return new
        {
            id = passkey.Id,
            deviceName = passkey.DeviceName,
            credentialType = passkey.CredentialType,
            transports = passkey.Transports,
            isBackedUp = passkey.IsBackedUp,
            createdAt = passkey.CreatedAt,
            lastUsedAt = passkey.LastUsedAt
        };
    }

    private static string? NormalizeDeviceName(string? deviceName)
    {
        var normalized = deviceName?.Trim();

        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        return normalized.Length <= 120
            ? normalized
            : normalized[..120];
    }

    private static bool IsValidTotpCode(string secret, string code)
    {
        var normalizedCode = NormalizeCode(code);

        if (normalizedCode.Length != 6)
        {
            return false;
        }

        var secretBytes = OtpNet.Base32Encoding.ToBytes(secret);
        var totp = new OtpNet.Totp(secretBytes, step: 30, totpSize: 6);

        return totp.VerifyTotp(
            normalizedCode,
            out _,
            OtpNet.VerificationWindow.RfcSpecifiedNetworkDelay);
    }

    private static string NormalizeCode(string? code)
    {
        return new string((code ?? string.Empty).Where(char.IsDigit).ToArray());
    }
}
