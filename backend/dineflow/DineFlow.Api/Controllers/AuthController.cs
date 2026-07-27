using Amazon.S3;
using Amazon.S3.Model;
using DineFlow.Api.Authorization;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Facebook;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Encodings.Web;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private const string MagicLinkLoginPurpose = "MagicLinkLogin";
    private const long MaxAvatarBytes = 2 * 1024 * 1024;
    private static readonly IReadOnlyDictionary<string, string> AllowedAvatarExtensionsByContentType =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["image/jpeg"] = ".jpg",
            ["image/png"] = ".png",
            ["image/webp"] = ".webp"
        };

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly SignInManager<ApplicationUser> _signInManager;
    private readonly IJwtTokenService _jwtTokenService;
    private readonly IRefreshTokenService _refreshTokenService;
    private readonly IEmailSender _emailSender;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IOAuthLoginCodeStore _oauthLoginCodeStore;
    private readonly IMfaEmailSetupCodeStore _mfaEmailCodeStore;
    private readonly IMfaLoginChallengeStore _mfaLoginChallengeStore;
    private readonly AppDbContext _dbContext;
    private readonly EmailOptions _emailOptions;
    private readonly AvatarStorageOptions _avatarStorageOptions;
    private readonly IAmazonS3 _s3Client;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<AuthController> _logger;
    private readonly ReportLogWriter _reportLogWriter;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager,
        IJwtTokenService jwtTokenService,
        IRefreshTokenService refreshTokenService,
        IEmailSender emailSender,
        IHttpClientFactory httpClientFactory,
        IOAuthLoginCodeStore oauthLoginCodeStore,
        IMfaEmailSetupCodeStore mfaEmailCodeStore,
        IMfaLoginChallengeStore mfaLoginChallengeStore,
        AppDbContext dbContext,
        IOptions<EmailOptions> emailOptions,
        IOptions<AvatarStorageOptions> avatarStorageOptions,
        IAmazonS3 s3Client,
        IWebHostEnvironment environment,
        ILogger<AuthController> logger,
        ReportLogWriter reportLogWriter)
    {
        _userManager = userManager;
        _signInManager = signInManager;
        _jwtTokenService = jwtTokenService;
        _refreshTokenService = refreshTokenService;
        _emailSender = emailSender;
        _httpClientFactory = httpClientFactory;
        _oauthLoginCodeStore = oauthLoginCodeStore;
        _mfaEmailCodeStore = mfaEmailCodeStore;
        _mfaLoginChallengeStore = mfaLoginChallengeStore;
        _dbContext = dbContext;
        _emailOptions = emailOptions.Value;
        _avatarStorageOptions = avatarStorageOptions.Value;
        _s3Client = s3Client;
        _environment = environment;
        _logger = logger;
        _reportLogWriter = reportLogWriter;
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpPost("register-restaurant-owner")]
    public async Task<IActionResult> RegisterRestaurantOwner(RegisterRestaurantUserRequest request)
    {
        if (request.RestaurantId is null)
        {
            return BadRequest(new
            {
                message = "RestaurantId is required."
            });
        }

        return await RegisterUserWithRoleAsync(request, ApplicationRoles.RestaurantOwner, request.RestaurantId);
    }

    [Authorize(Policy = AuthorizationPolicies.RestaurantOwnerApi)]
    [HttpPost("register-admin")]
    public async Task<IActionResult> RegisterAdmin(RegisterRestaurantUserRequest request)
    {
        var restaurantId = await ResolveRestaurantIdAsync(request.RestaurantId);

        if (restaurantId is null)
        {
            return BadRequest(new
            {
                message = "RestaurantId is required."
            });
        }

        return await RegisterUserWithRoleAsync(request, ApplicationRoles.Admin, restaurantId);
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("register-staff")]
    public async Task<IActionResult> RegisterStaff(RegisterRestaurantUserRequest request)
    {
        var restaurantId = await ResolveRestaurantIdAsync(request.RestaurantId);

        if (restaurantId is null)
        {
            return BadRequest(new
            {
                message = "RestaurantId is required."
            });
        }

        return await RegisterUserWithRoleAsync(request, ApplicationRoles.Staff, restaurantId);
    }

    [AllowAnonymous]
    [HttpPost("register-customer")]
    public async Task<IActionResult> RegisterCustomer(RegisterRequest request)
    {
        return await RegisterUserWithRoleAsync(request, ApplicationRoles.Customer, restaurantId: null);
    }

    [AllowAnonymous]
    [HttpPost("confirm-email")]
    public async Task<IActionResult> ConfirmEmail(ConfirmEmailRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) || string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new
            {
                message = "Confirmation link is invalid."
            });
        }

        var user = await _userManager.FindByIdAsync(request.UserId);

        if (user is null)
        {
            return BadRequest(new
            {
                message = "Confirmation link is invalid."
            });
        }

        if (await _userManager.IsEmailConfirmedAsync(user))
        {
            return Ok(new
            {
                message = "Email is already confirmed. You can now sign in."
            });
        }

        var result = await _userManager.ConfirmEmailAsync(user, request.Token);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Confirmation link is invalid or expired.",
                errors = result.Errors
            });
        }

        return await BuildAuthenticatedResponseAsync(user, "Email confirmed. You are now signed in.");
    }

    [AllowAnonymous]
    [HttpPost("resend-confirmation-email")]
    public async Task<IActionResult> ResendConfirmationEmail(ResendEmailConfirmationRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var user = await _userManager.FindByEmailAsync(request.Email.Trim());

            if (user is not null && !await _userManager.IsEmailConfirmedAsync(user))
            {
                try
                {
                    await SendConfirmationEmailAsync(user);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to resend confirmation email to {Email}.", user.Email);

                    return BadRequest(new
                    {
                        message = "Failed to send confirmation email.",
                        detail = ex.Message
                    });
                }
            }
        }

        return Ok(new
        {
            message = "If an unconfirmed account exists for that email, a confirmation link has been sent."
        });
    }

    [AllowAnonymous]
    [HttpPost("request-magic-link")]
    public async Task<IActionResult> RequestMagicLink(RequestMagicLinkRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var user = await _userManager.FindByEmailAsync(request.Email.Trim());

            if (user is not null && await _userManager.IsEmailConfirmedAsync(user))
            {
                try
                {
                    await SendMagicLinkEmailAsync(user);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send magic link email to {Email}.", user.Email);
                }
            }
        }

        return Ok(new
        {
            message = "If a confirmed account exists for that email, a sign-in link has been sent."
        });
    }

    [AllowAnonymous]
    [HttpPost("request-password-reset")]
    public async Task<IActionResult> RequestPasswordReset(RequestPasswordResetRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            var user = await _userManager.FindByEmailAsync(request.Email.Trim());

            if (user is not null &&
                await _userManager.IsEmailConfirmedAsync(user) &&
                await _userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
            {
                try
                {
                    await SendPasswordResetEmailAsync(user);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to send password reset email to {Email}.", user.Email);
                }
            }
        }

        return Ok(new
        {
            message = "If a confirmed customer account exists for that email, a password reset link has been sent."
        });
    }

    [Authorize]
    [HttpPost("me/request-password-reset")]
    public async Task<IActionResult> RequestCurrentUserPasswordReset(
        RequestCurrentUserPasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null || string.IsNullOrWhiteSpace(user.Email))
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        var mfaProtectsSensitiveActions = await SensitiveActionMfaIsEnabledAsync(user.Id, cancellationToken);

        if (!mfaProtectsSensitiveActions)
        {
            await SendPasswordResetEmailAsync(user);
            _reportLogWriter.AddAudit(
                "Auth.PasswordResetRequested",
                "User",
                user.Id,
                user.RestaurantId,
                $"Password reset email sent for {user.Email}.",
                after: new
                {
                    user.Email,
                    user.RestaurantId,
                    Delivery = "email"
                });
            await _dbContext.SaveChangesAsync(cancellationToken);

            return Ok(new
            {
                message = "Password reset link sent."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new
            {
                message = "New password is required."
            });
        }

        if (!await ValidateSensitiveActionAsync(user.Id, request.Verification, cancellationToken))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to update your password."
            });
        }

        var resetToken = await _userManager.GeneratePasswordResetTokenAsync(user);
        var result = await _userManager.ResetPasswordAsync(user, resetToken, request.Password);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Password does not meet requirements.",
                errors = result.Errors
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.PasswordUpdated",
            "User",
            user.Id,
            user.RestaurantId,
            $"Password updated for {user.Email}.",
            after: new
            {
                user.Email,
                user.RestaurantId,
                MfaVerified = true
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Password updated."
        });
    }

    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) ||
            string.IsNullOrWhiteSpace(request.Token) ||
            string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new
            {
                message = "Password reset link is invalid."
            });
        }

        var user = await _userManager.FindByIdAsync(request.UserId);

        if (user is null ||
            !await _userManager.IsEmailConfirmedAsync(user) ||
            !await _userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
        {
            return BadRequest(new
            {
                message = "Password reset link is invalid."
            });
        }

        var result = await _userManager.ResetPasswordAsync(user, request.Token, request.Password);

        if (!result.Succeeded)
        {
            var errors = result.Errors.ToArray();
            var invalidToken = errors.Any(error => error.Code == nameof(IdentityErrorDescriber.InvalidToken));

            return BadRequest(new
            {
                message = invalidToken
                    ? "Password reset link is invalid or expired. Request another link."
                    : "Password does not meet requirements.",
                errors
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.PasswordResetCompleted",
            "User",
            user.Id,
            user.RestaurantId,
            $"Password reset completed for {user.Email}.",
            after: new
            {
                user.Email,
                user.RestaurantId
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Password updated. You can now sign in with your new password."
        });
    }

    [AllowAnonymous]
    [HttpPost("magic-link-login")]
    public async Task<IActionResult> MagicLinkLogin(MagicLinkLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) || string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new
            {
                message = "Sign-in link is invalid."
            });
        }

        var user = await _userManager.FindByIdAsync(request.UserId);

        if (user is null || !await _userManager.IsEmailConfirmedAsync(user))
        {
            return BadRequest(new
            {
                message = "Sign-in link is invalid."
            });
        }

        var isValidToken = await _userManager.VerifyUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            MagicLinkLoginPurpose,
            request.Token);

        if (!isValidToken)
        {
            return BadRequest(new
            {
                message = "Sign-in link is invalid or expired."
            });
        }

        await _userManager.UpdateSecurityStampAsync(user);

        return await BuildAuthenticatedResponseAsync(user, "Magic link sign-in successful.");
    }

    [AllowAnonymous]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        if (user is null)
        {
            return Unauthorized(new
            {
                message = "Invalid email or password."
            });
        }

        var result = await _signInManager.CheckPasswordSignInAsync(
            user,
            request.Password,
            lockoutOnFailure: false
        );

        if (!result.Succeeded)
        {
            return Unauthorized(new
            {
                message = "Invalid email or password."
            });
        }

        if (!await _userManager.IsEmailConfirmedAsync(user))
        {
            return Unauthorized(new
            {
                message = "Please confirm your email before signing in."
            });
        }

        var mfaSettings = await _dbContext.UserMfaSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(settings => settings.UserId == user.Id);

        if (mfaSettings is not null &&
            mfaSettings.RequireForLogin &&
            (mfaSettings.TotpEnabled || mfaSettings.EmailEnabled))
        {
            var methods = new List<string>();
            string? emailCode = null;

            if (mfaSettings.TotpEnabled)
            {
                methods.Add(MfaMethods.Totp);
            }

            if (mfaSettings.EmailEnabled)
            {
                methods.Add(MfaMethods.Email);
                emailCode = GenerateSixDigitCode();
                await SendMfaLoginCodeEmailAsync(user, emailCode);
            }

            var challengeId = _mfaLoginChallengeStore.Create(user.Id, methods, emailCode);

            return Ok(new
            {
                message = "MFA verification is required.",
                mfaRequired = true,
                challengeId,
                methods,
                preferredMethod = mfaSettings.PreferredMethod
            });
        }

        return await BuildAuthenticatedResponseAsync(user, "Login successful.");
    }

    [AllowAnonymous]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(RefreshTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return Unauthorized(new { message = "Refresh token is required." });
        }

        var result = await _refreshTokenService.RotateAsync(request.RefreshToken, GetClientIpAddress());

        if (!result.Succeeded || result.UserId is null || result.NewRawToken is null)
        {
            return Unauthorized(new
            {
                message = result.FailureReason switch
                {
                    RefreshTokenFailureReason.Reused =>
                        "This session was signed out because the refresh token was reused. Please log in again.",
                    RefreshTokenFailureReason.Revoked =>
                        "You have been signed out. Please log in again.",
                    _ => "Session expired. Please log in again."
                }
            });
        }

        var user = await _userManager.FindByIdAsync(result.UserId);
        if (user is null)
        {
            return Unauthorized(new { message = "Session expired. Please log in again." });
        }

        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);
        var token = _jwtTokenService.GenerateToken(user.Id, user.Email, user.UserName, roles);

        _reportLogWriter.AddAudit(
            "Auth.TokenRefreshed",
            "User",
            user.Id,
            user.RestaurantId,
            "Access token refreshed via refresh token.");
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Token refreshed.",
            token,
            refreshToken = result.NewRawToken,
            user = userPayload
        });
    }

    [AllowAnonymous]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(RefreshTokenRequest request)
    {
        // Anonymous on purpose: logout must work even when the access token has
        // already expired. Revocation is idempotent, so this never leaks whether
        // the supplied token was valid.
        if (!string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            await _refreshTokenService.RevokeAsync(request.RefreshToken, GetClientIpAddress());
        }

        return Ok(new { message = "Logged out." });
    }

    [AllowAnonymous]
    [HttpGet("google/login")]
    public IActionResult GoogleLogin()
    {
        var redirectUrl = Url.Action(nameof(GoogleCallback), "Auth");
        var properties = _signInManager.ConfigureExternalAuthenticationProperties(
            GoogleDefaults.AuthenticationScheme,
            redirectUrl);

        return Challenge(properties, GoogleDefaults.AuthenticationScheme);
    }

    [AllowAnonymous]
    [HttpGet("google/callback")]
    public async Task<IActionResult> GoogleCallback(CancellationToken cancellationToken)
    {
        var authenticateResult = await HttpContext.AuthenticateAsync(IdentityConstants.ExternalScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return Redirect(BuildFrontendUrl("/login?oauthError=google_failed"));
        }

        var principal = authenticateResult.Principal;
        var providerKey = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = principal.FindFirstValue(ClaimTypes.Email);
        var fullName = principal.FindFirstValue(ClaimTypes.Name);
        var avatarUrl = principal.FindFirstValue("picture");

        if (string.IsNullOrWhiteSpace(providerKey) || string.IsNullOrWhiteSpace(email))
        {
            await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);

            return Redirect(BuildFrontendUrl("/login?oauthError=google_missing_profile"));
        }

        var user = await _userManager.FindByLoginAsync(GoogleDefaults.AuthenticationScheme, providerKey);

        if (user is null)
        {
            user = await _userManager.FindByEmailAsync(email);

            if (user is null)
            {
                user = new ApplicationUser
                {
                    UserName = email,
                    Email = email,
                    FullName = string.IsNullOrWhiteSpace(fullName) ? email : fullName,
                    EmailConfirmed = true,
                    CreatedAt = DateTime.UtcNow
                };

                var createResult = await _userManager.CreateAsync(user);

                if (!createResult.Succeeded)
                {
                    await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                    _logger.LogWarning("Google sign-in failed to create user for {Email}: {Errors}", email, createResult.Errors);

                    return Redirect(BuildFrontendUrl("/login?oauthError=google_create_failed"));
                }

                await _userManager.AddToRoleAsync(user, ApplicationRoles.Customer);

                var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

                if (!string.IsNullOrWhiteSpace(localAvatarUrl))
                {
                    user.AvatarUrl = localAvatarUrl;
                    user.UpdatedAt = DateTime.UtcNow;
                    await _userManager.UpdateAsync(user);
                }
            }
            else
            {
                var changed = false;

                if (!user.EmailConfirmed)
                {
                    user.EmailConfirmed = true;
                    changed = true;
                }

                if (string.IsNullOrWhiteSpace(user.AvatarUrl) && !string.IsNullOrWhiteSpace(avatarUrl))
                {
                    var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

                    if (!string.IsNullOrWhiteSpace(localAvatarUrl))
                    {
                        user.AvatarUrl = localAvatarUrl;
                        changed = true;
                    }
                }

                if (changed)
                {
                    user.UpdatedAt = DateTime.UtcNow;
                    await _userManager.UpdateAsync(user);
                }
            }

            var addLoginResult = await _userManager.AddLoginAsync(
                user,
                new UserLoginInfo(GoogleDefaults.AuthenticationScheme, providerKey, "Google"));

            if (!addLoginResult.Succeeded)
            {
                await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                _logger.LogWarning("Google sign-in failed to link login for {Email}: {Errors}", email, addLoginResult.Errors);

                return Redirect(BuildFrontendUrl("/login?oauthError=google_link_failed"));
            }
        }

        if (string.IsNullOrWhiteSpace(user.AvatarUrl) && !string.IsNullOrWhiteSpace(avatarUrl))
        {
            var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

            if (!string.IsNullOrWhiteSpace(localAvatarUrl))
            {
                user.AvatarUrl = localAvatarUrl;
                user.UpdatedAt = DateTime.UtcNow;
                await _userManager.UpdateAsync(user);
            }
        }

        await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);

        var code = _oauthLoginCodeStore.CreateCode(user.Id);

        return Redirect(BuildFrontendUrl($"/oauth/callback?code={Uri.EscapeDataString(code)}&provider=google"));
    }

    [AllowAnonymous]
    [HttpGet("facebook/login")]
    public IActionResult FacebookLogin()
    {
        var redirectUrl = Url.Action(nameof(FacebookCallback), "Auth");
        var properties = _signInManager.ConfigureExternalAuthenticationProperties(
            FacebookDefaults.AuthenticationScheme,
            redirectUrl);

        return Challenge(properties, FacebookDefaults.AuthenticationScheme);
    }

    [AllowAnonymous]
    [HttpGet("facebook/callback")]
    public async Task<IActionResult> FacebookCallback(CancellationToken cancellationToken)
    {
        var authenticateResult = await HttpContext.AuthenticateAsync(IdentityConstants.ExternalScheme);

        if (!authenticateResult.Succeeded || authenticateResult.Principal is null)
        {
            return Redirect(BuildFrontendUrl("/login?oauthError=facebook_failed"));
        }

        var principal = authenticateResult.Principal;
        var providerKey = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var email = principal.FindFirstValue(ClaimTypes.Email);
        var fullName = principal.FindFirstValue(ClaimTypes.Name);
        var avatarUrl = principal.FindFirstValue("picture");

        if (string.IsNullOrWhiteSpace(providerKey) || string.IsNullOrWhiteSpace(email))
        {
            await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);

            return Redirect(BuildFrontendUrl("/login?oauthError=facebook_missing_profile"));
        }

        var user = await _userManager.FindByLoginAsync(FacebookDefaults.AuthenticationScheme, providerKey);

        if (user is null)
        {
            user = await _userManager.FindByEmailAsync(email);

            if (user is null)
            {
                user = new ApplicationUser
                {
                    UserName = email,
                    Email = email,
                    FullName = string.IsNullOrWhiteSpace(fullName) ? email : fullName,
                    EmailConfirmed = true,
                    CreatedAt = DateTime.UtcNow
                };

                var createResult = await _userManager.CreateAsync(user);

                if (!createResult.Succeeded)
                {
                    await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                    _logger.LogWarning("Facebook sign-in failed to create user for {Email}: {Errors}", email, createResult.Errors);

                    return Redirect(BuildFrontendUrl("/login?oauthError=facebook_create_failed"));
                }

                await _userManager.AddToRoleAsync(user, ApplicationRoles.Customer);

                var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

                if (!string.IsNullOrWhiteSpace(localAvatarUrl))
                {
                    user.AvatarUrl = localAvatarUrl;
                    user.UpdatedAt = DateTime.UtcNow;
                    await _userManager.UpdateAsync(user);
                }
            }
            else
            {
                var changed = false;

                if (!user.EmailConfirmed)
                {
                    user.EmailConfirmed = true;
                    changed = true;
                }

                if (string.IsNullOrWhiteSpace(user.AvatarUrl) && !string.IsNullOrWhiteSpace(avatarUrl))
                {
                    var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

                    if (!string.IsNullOrWhiteSpace(localAvatarUrl))
                    {
                        user.AvatarUrl = localAvatarUrl;
                        changed = true;
                    }
                }

                if (changed)
                {
                    user.UpdatedAt = DateTime.UtcNow;
                    await _userManager.UpdateAsync(user);
                }
            }

            var addLoginResult = await _userManager.AddLoginAsync(
                user,
                new UserLoginInfo(FacebookDefaults.AuthenticationScheme, providerKey, "Facebook"));

            if (!addLoginResult.Succeeded)
            {
                await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                _logger.LogWarning("Facebook sign-in failed to link login for {Email}: {Errors}", email, addLoginResult.Errors);

                return Redirect(BuildFrontendUrl("/login?oauthError=facebook_link_failed"));
            }
        }

        if (string.IsNullOrWhiteSpace(user.AvatarUrl) && !string.IsNullOrWhiteSpace(avatarUrl))
        {
            var localAvatarUrl = await SaveRemoteGoogleAvatarAsync(avatarUrl, user.Id, cancellationToken);

            if (!string.IsNullOrWhiteSpace(localAvatarUrl))
            {
                user.AvatarUrl = localAvatarUrl;
                user.UpdatedAt = DateTime.UtcNow;
                await _userManager.UpdateAsync(user);
            }
        }

        await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);

        var code = _oauthLoginCodeStore.CreateCode(user.Id);

        return Redirect(BuildFrontendUrl($"/oauth/callback?code={Uri.EscapeDataString(code)}&provider=facebook"));
    }

    [AllowAnonymous]
    [HttpPost("oauth/exchange")]
    public async Task<IActionResult> ExchangeOAuthCode(ExchangeOAuthCodeRequest request)
    {
        if (!_oauthLoginCodeStore.TryConsumeCode(request.Code, out var userId))
        {
            return BadRequest(new
            {
                message = "OAuth sign-in code is invalid or expired."
            });
        }

        var user = await _userManager.FindByIdAsync(userId);

        if (user is null || !await _userManager.IsEmailConfirmedAsync(user))
        {
            return BadRequest(new
            {
                message = "OAuth sign-in code is invalid."
            });
        }

        return await BuildAuthenticatedResponseAsync(user, "Sign-in successful.");
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);

        return Ok(userPayload);
    }

    [Authorize]
    [HttpPut("me")]
    public async Task<IActionResult> UpdateMe(UpdateCurrentUserRequest request)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        if (!await _userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Only customers can update their own profile here."
            });
        }

        var nextFullName = request.FullName.Trim();

        if (string.IsNullOrWhiteSpace(nextFullName))
        {
            return BadRequest(new
            {
                message = "Full name is required."
            });
        }

        var beforeProfile = new
        {
            user.FullName,
            user.Email,
            user.RestaurantId
        };

        user.FullName = nextFullName;
        user.UpdatedAt = DateTime.UtcNow;

        var result = await _userManager.UpdateAsync(user);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to update profile.",
                errors = result.Errors
            });
        }

        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);

        _reportLogWriter.AddAudit(
            "Auth.ProfileUpdated",
            "User",
            user.Id,
            user.RestaurantId,
            $"Profile updated for {user.Email}.",
            beforeProfile,
            new
            {
                user.FullName,
                user.Email,
                user.RestaurantId
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Profile updated.",
            user = userPayload
        });
    }

    [Authorize]
    [HttpPost("me/avatar/upload-url")]
    public async Task<IActionResult> CreateAvatarUploadUrl(CreateAvatarUploadUrlRequest request)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        if (!IsS3AvatarStorageEnabled())
        {
            return BadRequest(new
            {
                message = "Presigned avatar uploads are not enabled."
            });
        }

        if (request.FileSize <= 0)
        {
            return BadRequest(new
            {
                message = "Avatar image is required."
            });
        }

        if (request.FileSize > MaxAvatarBytes)
        {
            return BadRequest(new
            {
                message = "Avatar image must be 2MB or smaller."
            });
        }

        if (!AllowedAvatarExtensionsByContentType.TryGetValue(request.ContentType, out var extension))
        {
            return BadRequest(new
            {
                message = "Avatar image must be a JPG, PNG, or WebP file."
            });
        }

        var objectKey = $"uploads/avatars/{user.Id}/{Guid.NewGuid():N}{extension}";
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(Math.Max(1, _avatarStorageOptions.UploadUrlExpirationMinutes));
        var presignedRequest = new GetPreSignedUrlRequest
        {
            BucketName = _avatarStorageOptions.Bucket,
            Key = objectKey,
            Verb = HttpVerb.PUT,
            Expires = expiresAt.UtcDateTime,
            ContentType = request.ContentType
        };
        string uploadUrl;

        try
        {
            uploadUrl = RewriteUploadUrlForClient(await _s3Client.GetPreSignedURLAsync(presignedRequest));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create avatar upload URL for bucket {Bucket}.", _avatarStorageOptions.Bucket);

            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                message = "Failed to create avatar upload URL. Check avatar storage credentials and bucket configuration."
            });
        }

        return Ok(new CreateAvatarUploadUrlResponse
        {
            Provider = "S3",
            UploadUrl = uploadUrl,
            ObjectKey = objectKey,
            AvatarUrl = BuildAvatarPublicUrl(objectKey),
            ExpiresAt = expiresAt,
            Headers = new Dictionary<string, string>
            {
                ["Content-Type"] = request.ContentType
            }
        });
    }

    [Authorize]
    [HttpPost("me/avatar/complete")]
    public async Task<IActionResult> CompleteAvatarUpload(CompleteAvatarUploadRequest request, CancellationToken cancellationToken)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        if (!IsS3AvatarStorageEnabled())
        {
            return BadRequest(new
            {
                message = "Presigned avatar uploads are not enabled."
            });
        }

        var objectKey = request.ObjectKey?.Trim();

        if (string.IsNullOrWhiteSpace(objectKey) ||
            !objectKey.StartsWith($"uploads/avatars/{user.Id}/", StringComparison.Ordinal))
        {
            return BadRequest(new
            {
                message = "Invalid avatar upload key."
            });
        }

        GetObjectMetadataResponse metadata;

        try
        {
            metadata = await _s3Client.GetObjectMetadataAsync(
                _avatarStorageOptions.Bucket,
                objectKey,
                cancellationToken);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return BadRequest(new
            {
                message = "Uploaded avatar was not found."
            });
        }

        if (metadata.Headers.ContentLength <= 0 || metadata.Headers.ContentLength > MaxAvatarBytes)
        {
            return BadRequest(new
            {
                message = "Uploaded avatar is invalid."
            });
        }

        if (!AllowedAvatarExtensionsByContentType.ContainsKey(metadata.Headers.ContentType))
        {
            return BadRequest(new
            {
                message = "Uploaded avatar image must be a JPG, PNG, or WebP file."
            });
        }

        var previousAvatarUrl = user.AvatarUrl;
        user.AvatarUrl = BuildAvatarPublicUrl(objectKey);
        user.UpdatedAt = DateTime.UtcNow;

        var result = await _userManager.UpdateAsync(user);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to update avatar.",
                errors = result.Errors
            });
        }

        await DeleteStoredAvatarAsync(previousAvatarUrl, user.Id, cancellationToken);

        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);

        _reportLogWriter.AddAudit(
            "Auth.AvatarUpdated",
            "User",
            user.Id,
            user.RestaurantId,
            $"Avatar updated for {user.Email}.",
            new
            {
                AvatarUrl = previousAvatarUrl
            },
            new
            {
                user.AvatarUrl
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Avatar updated.",
            user = userPayload
        });
    }

    [Authorize]
    [HttpPost("me/avatar")]
    public async Task<IActionResult> UploadAvatar(IFormFile? file, CancellationToken cancellationToken)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        if (file is null || file.Length == 0)
        {
            return BadRequest(new
            {
                message = "Avatar image is required."
            });
        }

        if (file.Length > MaxAvatarBytes)
        {
            return BadRequest(new
            {
                message = "Avatar image must be 2MB or smaller."
            });
        }

        if (!AllowedAvatarExtensionsByContentType.TryGetValue(file.ContentType, out var extension))
        {
            return BadRequest(new
            {
                message = "Avatar image must be a JPG, PNG, or WebP file."
            });
        }

        var webRootPath = GetWebRootPath();
        var avatarDirectory = Path.Combine(webRootPath, "uploads", "avatars");
        Directory.CreateDirectory(avatarDirectory);

        var fileName = $"{user.Id}-{Guid.NewGuid():N}{extension}";
        var filePath = Path.Combine(avatarDirectory, fileName);

        await using (var stream = System.IO.File.Create(filePath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var previousAvatarUrl = user.AvatarUrl;
        user.AvatarUrl = $"/uploads/avatars/{fileName}";
        user.UpdatedAt = DateTime.UtcNow;

        var result = await _userManager.UpdateAsync(user);

        if (!result.Succeeded)
        {
            System.IO.File.Delete(filePath);

            return BadRequest(new
            {
                message = "Failed to update avatar.",
                errors = result.Errors
            });
        }

        await DeleteStoredAvatarAsync(previousAvatarUrl, user.Id, cancellationToken);

        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);

        _reportLogWriter.AddAudit(
            "Auth.AvatarUpdated",
            "User",
            user.Id,
            user.RestaurantId,
            $"Avatar updated for {user.Email}.",
            new
            {
                AvatarUrl = previousAvatarUrl
            },
            new
            {
                user.AvatarUrl
            });
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            message = "Avatar updated.",
            user = userPayload
        });
    }

    [Authorize]
    [HttpPost("request-email-change")]
    public async Task<IActionResult> RequestEmailChange(RequestEmailChangeRequest request)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var user = await _userManager.FindByIdAsync(currentUserId);

        if (user is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        if (!await _userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Only customers can update their own email here."
            });
        }

        var newEmail = request.NewEmail.Trim();

        if (string.IsNullOrWhiteSpace(newEmail))
        {
            return BadRequest(new
            {
                message = "New email is required."
            });
        }

        if (string.Equals(user.Email, newEmail, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new
            {
                message = "New email must be different from your current email."
            });
        }

        if (!await _userManager.CheckPasswordAsync(user, request.CurrentPassword))
        {
            return Unauthorized(new
            {
                message = "Current password is incorrect."
            });
        }

        var existingUser = await _userManager.FindByEmailAsync(newEmail);

        if (existingUser is not null)
        {
            return BadRequest(new
            {
                message = "Email is already in use."
            });
        }

        try
        {
            await SendEmailChangeConfirmationAsync(user, newEmail);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email change confirmation to {Email}.", newEmail);

            return BadRequest(new
            {
                message = "Failed to send email change confirmation.",
                detail = ex.Message
            });
        }

        _reportLogWriter.AddAudit(
            "Auth.EmailChangeRequested",
            "User",
            user.Id,
            user.RestaurantId,
            $"Email change requested for {user.Email}.",
            after: new
            {
                CurrentEmail = user.Email,
                RequestedEmail = newEmail,
                user.RestaurantId
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Check your new email to confirm the change."
        });
    }

    [AllowAnonymous]
    [HttpPost("confirm-email-change")]
    public async Task<IActionResult> ConfirmEmailChange(ConfirmEmailChangeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.UserId) ||
            string.IsNullOrWhiteSpace(request.NewEmail) ||
            string.IsNullOrWhiteSpace(request.Token))
        {
            return BadRequest(new
            {
                message = "Email change link is invalid."
            });
        }

        var user = await _userManager.FindByIdAsync(request.UserId);

        if (user is null || !await _userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
        {
            return BadRequest(new
            {
                message = "Email change link is invalid."
            });
        }

        var newEmail = request.NewEmail.Trim();
        var existingUser = await _userManager.FindByEmailAsync(newEmail);
        var previousEmail = user.Email;

        if (existingUser is not null && existingUser.Id != user.Id)
        {
            return BadRequest(new
            {
                message = "Email is already in use."
            });
        }

        var changeResult = await _userManager.ChangeEmailAsync(user, newEmail, request.Token);

        if (!changeResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Email change link is invalid or expired.",
                errors = changeResult.Errors
            });
        }

        var userNameResult = await _userManager.SetUserNameAsync(user, newEmail);

        if (!userNameResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Email was changed, but username update failed.",
                errors = userNameResult.Errors
            });
        }

        user.UpdatedAt = DateTime.UtcNow;
        await _userManager.UpdateSecurityStampAsync(user);

        _reportLogWriter.AddAudit(
            "Auth.EmailChanged",
            "User",
            user.Id,
            user.RestaurantId,
            $"Email changed from {previousEmail} to {user.Email}.",
            new
            {
                Email = previousEmail,
                user.RestaurantId
            },
            new
            {
                user.Email,
                user.RestaurantId
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Email updated. Please sign in again with your new email."
        });
    }

    private async Task<IActionResult> RegisterUserWithRoleAsync(
        RegisterRequest request,
        string role,
        Guid? restaurantId)
    {
        if (role != ApplicationRoles.Customer)
        {
            var permissionError = ValidateCanCreateRole(role);

            if (permissionError is not null)
            {
                return permissionError;
            }
        }

        var existingUser = await _userManager.FindByEmailAsync(request.Email);

        if (existingUser is not null)
        {
            if (role == ApplicationRoles.Customer &&
                !await _userManager.IsEmailConfirmedAsync(existingUser) &&
                existingUser.CreatedAt <= DateTime.UtcNow.Subtract(UnconfirmedCustomerCleanupService.ConfirmationWindow) &&
                await _userManager.IsInRoleAsync(existingUser, ApplicationRoles.Customer))
            {
                var deleteResult = await _userManager.DeleteAsync(existingUser);

                if (!deleteResult.Succeeded)
                {
                    return BadRequest(new
                    {
                        message = "Failed to replace expired unconfirmed account.",
                        errors = deleteResult.Errors
                    });
                }
            }
            else
            {
                return BadRequest(new
                {
                    message = "User already exists."
                });
            }
        }

        if (existingUser is not null)
        {
            existingUser = await _userManager.FindByEmailAsync(request.Email);
        }

        if (existingUser is not null)
        {
            return BadRequest(new
            {
                message = "User already exists."
            });
        }

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            FullName = request.FullName,
            RestaurantId = restaurantId,
            EmailConfirmed = role != ApplicationRoles.Customer,
            CreatedAt = DateTime.UtcNow
        };

        var result = await _userManager.CreateAsync(user, request.Password);

        if (!result.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to create user.",
                errors = result.Errors
            });
        }

        if (!await _userManager.IsInRoleAsync(user, role))
        {
            await _userManager.AddToRoleAsync(user, role);
        }

        var confirmationEmailSent = user.EmailConfirmed;

        if (role == ApplicationRoles.Customer)
        {
            try
            {
                await SendConfirmationEmailAsync(user);
                confirmationEmailSent = true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send confirmation email to {Email}.", user.Email);
            }
        }

        _reportLogWriter.AddAudit(
            "Auth.UserRegistered",
            "User",
            user.Id,
            user.RestaurantId,
            $"{role} user registered for {user.Email}.",
            after: new
            {
                user.Email,
                user.FullName,
                user.RestaurantId,
                user.EmailConfirmed,
                ConfirmationEmailSent = confirmationEmailSent,
                Role = role
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = role == ApplicationRoles.Customer
                ? "Customer registered. Please confirm your email before signing in."
                : $"{role} user registered successfully.",
            userId = user.Id,
            email = user.Email,
            restaurantId = user.RestaurantId,
            emailConfirmed = user.EmailConfirmed,
            confirmationEmailSent,
            role
        });
    }

    private async Task SendConfirmationEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send confirmation email.");
        }

        var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
        var confirmationUrl = BuildConfirmationUrl(user.Id, token);
        var encodedUrl = HtmlEncoder.Default.Encode(confirmationUrl);

        await _emailSender.SendAsync(
            user.Email,
            "Confirm your DineFlow email",
            $"""
            <p>Welcome to DineFlow.</p>
            <p>Confirm your email to finish creating your account.</p>
            <p><a href="{encodedUrl}">Confirm email</a></p>
            """,
            $"Confirm your DineFlow email: {confirmationUrl}");
    }

    private async Task SendMagicLinkEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send a magic link.");
        }

        var token = await _userManager.GenerateUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            MagicLinkLoginPurpose);
        var magicLinkUrl = BuildMagicLinkUrl(user.Id, token);
        var encodedUrl = HtmlEncoder.Default.Encode(magicLinkUrl);

        await _emailSender.SendAsync(
            user.Email,
            "Sign in to DineFlow",
            $"""
            <p>Use this secure link to sign in to DineFlow.</p>
            <p>This link expires in one hour and can only be used once.</p>
            <p><a href="{encodedUrl}">Sign in to DineFlow</a></p>
            """,
            $"Sign in to DineFlow: {magicLinkUrl}");
    }

    private async Task SendPasswordResetEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send a password reset link.");
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        var passwordResetUrl = BuildPasswordResetUrl(user.Id, token);
        var encodedUrl = HtmlEncoder.Default.Encode(passwordResetUrl);

        await _emailSender.SendAsync(
            user.Email,
            "Reset your DineFlow password",
            $"""
            <p>Use this secure link to reset your DineFlow password.</p>
            <p>This link expires in one hour.</p>
            <p><a href="{encodedUrl}">Reset password</a></p>
            """,
            $"Reset your DineFlow password: {passwordResetUrl}");
    }

    private async Task SendEmailChangeConfirmationAsync(ApplicationUser user, string newEmail)
    {
        var token = await _userManager.GenerateChangeEmailTokenAsync(user, newEmail);
        var emailChangeUrl = BuildEmailChangeUrl(user.Id, newEmail, token);
        var encodedUrl = HtmlEncoder.Default.Encode(emailChangeUrl);

        await _emailSender.SendAsync(
            newEmail,
            "Confirm your new DineFlow email",
            $"""
            <p>Confirm this email address for your DineFlow account.</p>
            <p>This link expires in one hour.</p>
            <p><a href="{encodedUrl}">Confirm new email</a></p>
            """,
            $"Confirm your new DineFlow email: {emailChangeUrl}");
    }

    private async Task SendMfaLoginCodeEmailAsync(ApplicationUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send an MFA code.");
        }

        await _emailSender.SendAsync(
            user.Email,
            "Your DineFlow verification code",
            $"""
            <p>Use this code to finish signing in to DineFlow.</p>
            <p><strong style="font-size: 24px; letter-spacing: 0.2em;">{HtmlEncoder.Default.Encode(code)}</strong></p>
            <p>This code expires in five minutes.</p>
            """,
            $"Your DineFlow verification code is {code}. It expires in five minutes.");
    }

    private async Task<IActionResult> BuildAuthenticatedResponseAsync(ApplicationUser user, string message)
    {
        var roles = await _userManager.GetRolesAsync(user);
        var userPayload = await BuildUserPayloadAsync(user, roles);
        var token = _jwtTokenService.GenerateToken(
            user.Id,
            user.Email,
            user.UserName,
            roles);
        var refreshToken = await _refreshTokenService.IssueAsync(user.Id, GetClientIpAddress());

        _reportLogWriter.AddAudit(
            GetAuthenticatedResponseAuditAction(message),
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
            refreshToken,
            user = userPayload
        });
    }

    private string? GetClientIpAddress() => HttpContext.Connection.RemoteIpAddress?.ToString();

    private async Task<object> BuildUserPayloadAsync(ApplicationUser user, IEnumerable<string> roles)
    {
        var logins = await _userManager.GetLoginsAsync(user);
        var externalProviders = logins
            .Select(login => login.LoginProvider)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(provider => provider, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new
        {
            id = user.Id,
            email = user.Email,
            fullName = user.FullName,
            avatarUrl = user.AvatarUrl,
            restaurantId = user.RestaurantId,
            roles,
            hasPassword = !string.IsNullOrWhiteSpace(user.PasswordHash),
            externalProviders
        };
    }

    private static string GetAuthenticatedResponseAuditAction(string message)
    {
        if (message.Contains("email confirmed", StringComparison.OrdinalIgnoreCase))
        {
            return "Auth.EmailConfirmed";
        }

        if (message.Contains("magic link", StringComparison.OrdinalIgnoreCase))
        {
            return "Auth.MagicLinkLoginSucceeded";
        }

        if (message.Contains("sign-in", StringComparison.OrdinalIgnoreCase))
        {
            return "Auth.OAuthLoginSucceeded";
        }

        return "Auth.LoginSucceeded";
    }

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

    private async Task<bool> SensitiveActionMfaIsEnabledAsync(string userId, CancellationToken cancellationToken)
    {
        var settings = await _dbContext.UserMfaSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(
                mfaSettings => mfaSettings.UserId == userId,
                cancellationToken);

        return settings is not null &&
            settings.RequireForSensitiveActions &&
            (settings.TotpEnabled || settings.EmailEnabled);
    }

    private string BuildConfirmationUrl(string userId, string token)
    {
        return BuildFrontendUrl($"/confirm-email?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}");
    }

    private string BuildMagicLinkUrl(string userId, string token)
    {
        return BuildFrontendUrl($"/magic-login?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}");
    }

    private string BuildPasswordResetUrl(string userId, string token)
    {
        return BuildFrontendUrl($"/reset-password?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}");
    }

    private string BuildEmailChangeUrl(string userId, string newEmail, string token)
    {
        return BuildFrontendUrl($"/change-email?userId={Uri.EscapeDataString(userId)}&email={Uri.EscapeDataString(newEmail)}&token={Uri.EscapeDataString(token)}");
    }

    private static string GenerateSixDigitCode()
    {
        return RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
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

    private string BuildFrontendUrl(string pathAndQuery)
    {
        var baseUrl = string.IsNullOrWhiteSpace(_emailOptions.FrontendBaseUrl)
            ? "http://localhost:5173"
            : _emailOptions.FrontendBaseUrl.TrimEnd('/');

        var normalizedPath = pathAndQuery.StartsWith('/')
            ? pathAndQuery
            : $"/{pathAndQuery}";

        return $"{baseUrl}{normalizedPath}";
    }

    private async Task<string?> SaveRemoteGoogleAvatarAsync(
        string? avatarUrl,
        string userId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl) ||
            !Uri.TryCreate(avatarUrl, UriKind.Absolute, out var avatarUri) ||
            avatarUri.Scheme != Uri.UriSchemeHttps)
        {
            return null;
        }

        try
        {
            var httpClient = _httpClientFactory.CreateClient();
            using var response = await httpClient.GetAsync(
                avatarUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "Google avatar download failed for user {UserId} with HTTP {StatusCode}.",
                    userId,
                    response.StatusCode);

                return null;
            }

            if (response.Content.Headers.ContentLength > MaxAvatarBytes)
            {
                _logger.LogWarning("Google avatar for user {UserId} exceeded the avatar size limit.", userId);

                return null;
            }

            var mediaType = response.Content.Headers.ContentType?.MediaType;

            if (string.IsNullOrWhiteSpace(mediaType) ||
                !AllowedAvatarExtensionsByContentType.TryGetValue(mediaType, out var extension))
            {
                _logger.LogWarning(
                    "Google avatar for user {UserId} used unsupported content type {ContentType}.",
                    userId,
                    mediaType ?? "unknown");

                return null;
            }

            await using var remoteStream = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var avatarBytes = new MemoryStream();

            var buffer = new byte[81920];
            long totalBytes = 0;

            while (true)
            {
                var bytesRead = await remoteStream.ReadAsync(buffer, cancellationToken);

                if (bytesRead == 0)
                {
                    break;
                }

                totalBytes += bytesRead;

                if (totalBytes > MaxAvatarBytes)
                {
                    _logger.LogWarning("Google avatar for user {UserId} exceeded the avatar size limit.", userId);

                    return null;
                }

                await avatarBytes.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
            }

            if (avatarBytes.Length == 0)
            {
                _logger.LogWarning("Google avatar for user {UserId} was empty.", userId);

                return null;
            }

            avatarBytes.Position = 0;

            if (IsS3AvatarStorageEnabled())
            {
                var objectKey = $"uploads/avatars/{userId}/google-{Guid.NewGuid():N}{extension}";
                var putRequest = new PutObjectRequest
                {
                    BucketName = _avatarStorageOptions.Bucket,
                    Key = objectKey,
                    InputStream = avatarBytes,
                    ContentType = mediaType
                };
                putRequest.Headers.ContentLength = avatarBytes.Length;

                await _s3Client.PutObjectAsync(putRequest, cancellationToken);

                return BuildAvatarPublicUrl(objectKey);
            }

            var webRootPath = GetWebRootPath();
            var avatarDirectory = Path.Combine(webRootPath, "uploads", "avatars");
            Directory.CreateDirectory(avatarDirectory);

            var fileName = $"{userId}-google-{Guid.NewGuid():N}{extension}";
            var filePath = Path.Combine(avatarDirectory, fileName);

            await using var localStream = System.IO.File.Create(filePath);
            await avatarBytes.CopyToAsync(localStream, cancellationToken);

            return $"/uploads/avatars/{fileName}";
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to persist Google avatar for user {UserId}.", userId);

            return null;
        }
    }

    private string GetWebRootPath()
    {
        return string.IsNullOrWhiteSpace(_environment.WebRootPath)
            ? Path.Combine(AppContext.BaseDirectory, "wwwroot")
            : _environment.WebRootPath;
    }

    private bool IsS3AvatarStorageEnabled()
    {
        return string.Equals(_avatarStorageOptions.Provider, "S3", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(_avatarStorageOptions.Bucket);
    }

    private string BuildAvatarPublicUrl(string objectKey)
    {
        if (!string.IsNullOrWhiteSpace(_avatarStorageOptions.PublicBaseUrl))
        {
            return $"{_avatarStorageOptions.PublicBaseUrl.TrimEnd('/')}/{objectKey}";
        }

        return $"https://{_avatarStorageOptions.Bucket}.s3.{_avatarStorageOptions.Region}.amazonaws.com/{objectKey}";
    }

    private string RewriteUploadUrlForClient(string uploadUrl)
    {
        if (string.IsNullOrWhiteSpace(_avatarStorageOptions.UploadBaseUrl) ||
            !Uri.TryCreate(uploadUrl, UriKind.Absolute, out var generatedUri) ||
            !Uri.TryCreate(_avatarStorageOptions.UploadBaseUrl, UriKind.Absolute, out var clientBaseUri))
        {
            return uploadUrl;
        }

        var builder = new UriBuilder(generatedUri)
        {
            Scheme = clientBaseUri.Scheme,
            Host = clientBaseUri.Host,
            Port = clientBaseUri.IsDefaultPort ? -1 : clientBaseUri.Port
        };

        return builder.Uri.ToString();
    }

    private async Task DeleteStoredAvatarAsync(string? avatarUrl, string userId, CancellationToken cancellationToken)
    {
        DeleteLocalAvatar(avatarUrl, GetWebRootPath());

        if (!TryGetOwnedS3AvatarObjectKey(avatarUrl, userId, out var objectKey))
        {
            return;
        }

        try
        {
            await _s3Client.DeleteObjectAsync(_avatarStorageOptions.Bucket, objectKey, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete previous S3 avatar object {ObjectKey}.", objectKey);
        }
    }

    private bool TryGetOwnedS3AvatarObjectKey(string? avatarUrl, string userId, out string objectKey)
    {
        objectKey = string.Empty;

        if (string.IsNullOrWhiteSpace(avatarUrl) ||
            string.IsNullOrWhiteSpace(_avatarStorageOptions.PublicBaseUrl))
        {
            return false;
        }

        var publicBaseUrl = _avatarStorageOptions.PublicBaseUrl.TrimEnd('/');

        if (!avatarUrl.StartsWith($"{publicBaseUrl}/", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var candidateKey = avatarUrl[(publicBaseUrl.Length + 1)..];
        candidateKey = Uri.UnescapeDataString(candidateKey);
        var ownedPrefix = $"uploads/avatars/{userId}/";

        if (!candidateKey.StartsWith(ownedPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        objectKey = candidateKey;
        return true;
    }

    private void DeleteLocalAvatar(string? avatarUrl, string webRootPath)
    {
        if (string.IsNullOrWhiteSpace(avatarUrl) ||
            !avatarUrl.StartsWith("/uploads/avatars/", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var fileName = Path.GetFileName(avatarUrl);
        var filePath = Path.Combine(webRootPath, "uploads", "avatars", fileName);

        try
        {
            if (System.IO.File.Exists(filePath))
            {
                System.IO.File.Delete(filePath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete previous avatar file {AvatarUrl}.", avatarUrl);
        }
    }

    private IActionResult? ValidateCanCreateRole(string targetRole)
    {
        if (!ApplicationRoles.RoleRanks.TryGetValue(targetRole, out var targetRank))
        {
            return BadRequest(new
            {
                message = "Invalid target role."
            });
        }

        var currentRank = ApplicationRoles.RoleRanks
            .Where(roleRank => User.IsInRole(roleRank.Key))
            .Select(roleRank => roleRank.Value)
            .DefaultIfEmpty(-1)
            .Max();

        if (currentRank <= targetRank)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "You can only create users with lower permissions than your own."
            });
        }

        return null;
    }

    private async Task<Guid?> ResolveRestaurantIdAsync(Guid? requestedRestaurantId)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return requestedRestaurantId;
        }

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return null;
        }

        var currentUser = await _userManager.FindByIdAsync(currentUserId);

        if (currentUser?.RestaurantId is null)
        {
            return null;
        }

        return currentUser.RestaurantId;
    }
}
