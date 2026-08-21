using Amazon.S3;
using Amazon.S3.Model;
using DineFlow.Api.Authorization;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Api.Contracts.Auth;
using DineFlow.Api.Compliance;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Facebook;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Globalization;
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
    private readonly TransactionalEmailLayout _emailLayout;
    private readonly StoredImageVerifier _storedImageVerifier;
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
        TransactionalEmailLayout emailLayout,
        StoredImageVerifier storedImageVerifier,
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
        _emailLayout = emailLayout;
        _storedImageVerifier = storedImageVerifier;
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
    [EnableRateLimiting(RateLimitPolicies.AuthenticationEmail)]
    [HttpPost("register-customer")]
    public async Task<IActionResult> RegisterCustomer(RegisterRequest request)
    {
        return await RegisterUserWithRoleAsync(request, ApplicationRoles.Customer, restaurantId: null);
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
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

        var confirmMfaChallenge = await CreateMfaLoginChallengeIfRequiredAsync(user, HttpContext.RequestAborted);

        if (confirmMfaChallenge is not null)
        {
            return confirmMfaChallenge;
        }

        return await BuildAuthenticatedResponseAsync(user, "Email confirmed. You are now signed in.");
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.AuthenticationEmail)]
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
    [EnableRateLimiting(RateLimitPolicies.AuthenticationEmail)]
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
    [EnableRateLimiting(RateLimitPolicies.AuthenticationEmail)]
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
                message = "MFA verification is required to update your password.",
                code = MfaVerificationCodes.SensitiveActionRequired
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
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
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
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [HttpPost("magic-link-login")]
    public async Task<IActionResult> MagicLinkLogin(
        MagicLinkLoginRequest request,
        CancellationToken cancellationToken)
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

        if (await _userManager.IsLockedOutAsync(user))
        {
            return LockedOutResponse(await _userManager.GetLockoutEndDateAsync(user));
        }

        var isValidToken = await _userManager.VerifyUserTokenAsync(
            user,
            TokenOptions.DefaultProvider,
            MagicLinkLoginPurpose,
            request.Token);

        if (!isValidToken)
        {
            // A guessable single-use token is still a credential, so a failed redemption counts
            // towards the same account lockout as a wrong password.
            await _userManager.AccessFailedAsync(user);

            return BadRequest(new
            {
                message = "Sign-in link is invalid or expired."
            });
        }

        await _userManager.ResetAccessFailedCountAsync(user);
        await _userManager.UpdateSecurityStampAsync(user);

        var mfaChallengeResponse = await CreateMfaLoginChallengeIfRequiredAsync(user, cancellationToken);

        if (mfaChallengeResponse is not null)
        {
            return mfaChallengeResponse;
        }

        return await BuildAuthenticatedResponseAsync(user, "Magic link sign-in successful.");
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
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

        // lockoutOnFailure counts the attempt against the account, which is the only control that
        // survives an attacker rotating source addresses. A success resets the counter.
        var result = await _signInManager.CheckPasswordSignInAsync(
            user,
            request.Password,
            lockoutOnFailure: true
        );

        if (result.IsLockedOut)
        {
            return LockedOutResponse(await _userManager.GetLockoutEndDateAsync(user));
        }

        if (!result.Succeeded)
        {
            return Unauthorized(new
            {
                message = "Invalid email or password."
            });
        }

        if (!await _userManager.IsEmailConfirmedAsync(user))
        {
            // The password was right, so this is not a credential problem and saying so is not a
            // disclosure. No token is issued — the account stays unusable until the address is
            // confirmed — but the client now has enough to offer a resend instead of a dead end.
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Confirm your email address before signing in.",
                code = "email_not_confirmed",
                email = user.Email
            });
        }

        var mfaChallengeResponse = await CreateMfaLoginChallengeIfRequiredAsync(
            user,
            HttpContext.RequestAborted);

        if (mfaChallengeResponse is not null)
        {
            return mfaChallengeResponse;
        }

        return await BuildAuthenticatedResponseAsync(user, "Login successful.");
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.TokenLifecycle)]
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(RefreshTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.RefreshToken))
        {
            return Unauthorized(new { message = "Refresh token is required." });
        }

        var result = await _refreshTokenService.RotateAsync(request.RefreshToken, GetClientIpAddress());

        // Answered apart from the failures below, and deliberately not as 401: nothing is wrong with
        // this session. A sibling tab rotated the shared token a moment ago and has already stored
        // the replacement, so the caller should read that and carry on rather than sign anybody out.
        if (result.FailureReason == RefreshTokenFailureReason.RotationRace)
        {
            return Conflict(new
            {
                message = "This session was refreshed in another tab. Retry with the stored token.",
                retry = true
            });
        }

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
            "Access token refreshed via refresh token.",
            actorOverride: ReportActor.User(
                user.Id,
                user.FullName ?? user.Email ?? "DineFlow user",
                user.Email,
                roles),
            correlationId: user.Id);
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
    [EnableRateLimiting(RateLimitPolicies.TokenLifecycle)]
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
    public IActionResult GoogleLogin(
        [FromQuery] string? customerTermsVersion,
        [FromQuery] string? privacyPolicyVersion,
        [FromQuery] string? returnTo)
    {
        var redirectUrl = Url.Action(nameof(GoogleCallback), "Auth");
        var properties = _signInManager.ConfigureExternalAuthenticationProperties(
            GoogleDefaults.AuthenticationScheme,
            redirectUrl);
        properties.Items["customerTermsVersion"] = customerTermsVersion ?? string.Empty;
        properties.Items["privacyPolicyVersion"] = privacyPolicyVersion ?? string.Empty;
        // Carried through the provider so a customer who signed in from a restaurant menu is handed
        // back to it. Sanitised on the way out again, not here: what returns is what matters.
        properties.Items[ExternalReturnToKey] = OAuthReturnPath.Sanitize(returnTo) ?? string.Empty;

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
                if (!HasCurrentOAuthLegalConsent(authenticateResult.Properties))
                {
                    await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                    return Redirect(BuildFrontendUrl("/login?oauthError=legal_consent_required"));
                }
                user = new ApplicationUser
                {
                    UserName = email,
                    Email = email,
                    FullName = string.IsNullOrWhiteSpace(fullName) ? email : fullName,
                    EmailConfirmed = true,
                    CreatedAt = DateTime.UtcNow,
                    AcceptedCustomerTermsVersion = LegalDocumentVersions.CustomerTerms,
                    AcknowledgedPrivacyPolicyVersion = LegalDocumentVersions.PrivacyPolicy,
                    LegalAcceptedAt = DateTime.UtcNow,
                    LegalAcceptanceIpAddress = GetClientIpAddress(),
                    LegalAcceptanceUserAgent = Request.Headers.UserAgent.ToString()
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
        var returnTo = BuildExternalReturnToQuery(authenticateResult.Properties);

        return Redirect(BuildFrontendUrl(
            $"/oauth/callback?code={Uri.EscapeDataString(code)}&provider=google{returnTo}"));
    }

    [AllowAnonymous]
    [HttpGet("facebook/login")]
    public IActionResult FacebookLogin(
        [FromQuery] string? customerTermsVersion,
        [FromQuery] string? privacyPolicyVersion,
        [FromQuery] string? returnTo)
    {
        var redirectUrl = Url.Action(nameof(FacebookCallback), "Auth");
        var properties = _signInManager.ConfigureExternalAuthenticationProperties(
            FacebookDefaults.AuthenticationScheme,
            redirectUrl);
        properties.Items["customerTermsVersion"] = customerTermsVersion ?? string.Empty;
        properties.Items["privacyPolicyVersion"] = privacyPolicyVersion ?? string.Empty;
        properties.Items[ExternalReturnToKey] = OAuthReturnPath.Sanitize(returnTo) ?? string.Empty;

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
                if (!HasCurrentOAuthLegalConsent(authenticateResult.Properties))
                {
                    await HttpContext.SignOutAsync(IdentityConstants.ExternalScheme);
                    return Redirect(BuildFrontendUrl("/login?oauthError=legal_consent_required"));
                }
                user = new ApplicationUser
                {
                    UserName = email,
                    Email = email,
                    FullName = string.IsNullOrWhiteSpace(fullName) ? email : fullName,
                    EmailConfirmed = true,
                    CreatedAt = DateTime.UtcNow,
                    AcceptedCustomerTermsVersion = LegalDocumentVersions.CustomerTerms,
                    AcknowledgedPrivacyPolicyVersion = LegalDocumentVersions.PrivacyPolicy,
                    LegalAcceptedAt = DateTime.UtcNow,
                    LegalAcceptanceIpAddress = GetClientIpAddress(),
                    LegalAcceptanceUserAgent = Request.Headers.UserAgent.ToString()
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
        var returnTo = BuildExternalReturnToQuery(authenticateResult.Properties);

        return Redirect(BuildFrontendUrl(
            $"/oauth/callback?code={Uri.EscapeDataString(code)}&provider=facebook{returnTo}"));
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
    [HttpPost("oauth/exchange")]
    public async Task<IActionResult> ExchangeOAuthCode(
        ExchangeOAuthCodeRequest request,
        CancellationToken cancellationToken)
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

        // The same gate as password and magic-link sign-in. Without it "Ask for MFA when this
        // account signs in" was a setting the provider routes quietly ignored, which is worse than
        // not offering it: someone who turned it on had no way to find out it did not apply.
        var mfaChallengeResponse = await CreateMfaLoginChallengeIfRequiredAsync(user, cancellationToken);

        if (mfaChallengeResponse is not null)
        {
            return mfaChallengeResponse;
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

        var nextFullNameProblem = AccountFieldLimits.DescribeFullNameProblem(request.FullName);

        if (nextFullNameProblem is not null)
        {
            return BadRequest(new { message = nextFullNameProblem });
        }

        var nextFullName = AccountFieldLimits.NormalizeFullName(request.FullName);

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

        // A presigned upload goes straight to the bucket, so this is the first time we can see the
        // bytes. Only the head of the object is fetched — enough to tell an image from a disguise.
        if (!await _storedImageVerifier.IsDeclaredImageAsync(
                _avatarStorageOptions.Bucket,
                objectKey,
                metadata.Headers.ContentType,
                cancellationToken))
        {
            await _storedImageVerifier.DeleteAsync(_avatarStorageOptions.Bucket, objectKey, cancellationToken);

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

        // The content type above is whatever the uploader typed on the request. Read what the file
        // actually is before storing it under a name that says "image".
        await using (var header = file.OpenReadStream())
        {
            var leadingBytes = await ImageContentSignature.ReadHeaderAsync(header, cancellationToken);

            if (!ImageContentSignature.Matches(leadingBytes, file.ContentType))
            {
                return BadRequest(new
                {
                    message = "Avatar image must be a JPG, PNG, or WebP file."
                });
            }
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

        // Changing the address is the account recovery action: every reset link and email code
        // follows it to the new inbox. The password alone was the only thing standing in front of
        // it, on an account whose owner asked for more than a password.
        if (!await ValidateSensitiveActionAsync(user.Id, request.Verification, HttpContext.RequestAborted))
        {
            return BadRequest(new
            {
                message = "MFA verification is required to change your email address.",
                code = MfaVerificationCodes.SensitiveActionRequired
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

        // The current address is the only one an attacker holding the account has no reason to
        // watch, so this is the real owner's one chance to notice. Best effort: a warning that
        // cannot be delivered must not stop a change the account holder legitimately asked for.
        await TrySendEmailChangeNoticeAsync(user.Email!, newEmail, alreadyChanged: false);

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
    [EnableRateLimiting(RateLimitPolicies.Authentication)]
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

        // The address and the username are one identity, and Identity writes them in two separate
        // saves. A failure between the two used to leave the account signing in under the old
        // username while mail went to the new address, and the response said so and stopped there.
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(HttpContext.RequestAborted);

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
            // Nothing is committed: the account keeps the address it had.
            return BadRequest(new
            {
                message = "Email change could not be completed. Your address is unchanged.",
                errors = userNameResult.Errors
            });
        }

        user.UpdatedAt = DateTime.UtcNow;
        await _userManager.UpdateSecurityStampAsync(user);

        // Sessions elsewhere were issued to the old identity and survive the change; on a stolen
        // account that is exactly the session the real owner cannot see or reach.
        await _refreshTokenService.RevokeAllForUserAsync(
            user.Id,
            GetClientIpAddress(),
            HttpContext.RequestAborted);

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
        await _dbContext.SaveChangesAsync(HttpContext.RequestAborted);
        await transaction.CommitAsync(HttpContext.RequestAborted);

        // After the commit: the change is done either way, and a mail failure must not undo it.
        await TrySendEmailChangeNoticeAsync(previousEmail!, newEmail, alreadyChanged: true);

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
        var sendPasswordSetupEmail =
            role != ApplicationRoles.Customer &&
            request is RegisterRestaurantUserRequest { SendPasswordSetupEmail: true };

        if (role == ApplicationRoles.Customer &&
            (request.AcceptedCustomerTermsVersion != LegalDocumentVersions.CustomerTerms ||
             request.AcknowledgedPrivacyPolicyVersion != LegalDocumentVersions.PrivacyPolicy))
        {
            return BadRequest(new
            {
                message = "Accept the current Customer Terms and acknowledge the current Privacy Policy.",
                requiredCustomerTermsVersion = LegalDocumentVersions.CustomerTerms,
                requiredPrivacyPolicyVersion = LegalDocumentVersions.PrivacyPolicy
            });
        }

        if (role != ApplicationRoles.Customer)
        {
            var permissionError = ValidateCanCreateRole(role);

            if (permissionError is not null)
            {
                return permissionError;
            }
        }

        if (!sendPasswordSetupEmail && string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new
            {
                message = "Password is required when a password setup email is not requested."
            });
        }

        var fullNameProblem = AccountFieldLimits.DescribeFullNameProblem(request.FullName);

        if (fullNameProblem is not null)
        {
            return BadRequest(new { message = fullNameProblem });
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
            FullName = AccountFieldLimits.NormalizeFullName(request.FullName),
            RestaurantId = restaurantId,
            EmailConfirmed = role != ApplicationRoles.Customer,
            CreatedAt = DateTime.UtcNow
        };

        if (role == ApplicationRoles.Customer)
        {
            user.AcceptedCustomerTermsVersion = request.AcceptedCustomerTermsVersion;
            user.AcknowledgedPrivacyPolicyVersion = request.AcknowledgedPrivacyPolicyVersion;
            user.LegalAcceptedAt = DateTime.UtcNow;
            user.LegalAcceptanceIpAddress = GetClientIpAddress();
            user.LegalAcceptanceUserAgent = Request.Headers.UserAgent.ToString();
        }

        var result = sendPasswordSetupEmail
            ? await _userManager.CreateAsync(user)
            : await _userManager.CreateAsync(user, request.Password);

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
            var roleResult = await _userManager.AddToRoleAsync(user, role);

            if (!roleResult.Succeeded)
            {
                await _userManager.DeleteAsync(user);
                return BadRequest(new
                {
                    message = "Failed to assign the user role.",
                    errors = roleResult.Errors
                });
            }
        }

        var confirmationEmailSent = user.EmailConfirmed;
        var passwordSetupEmailSent = false;

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
        else if (sendPasswordSetupEmail)
        {
            try
            {
                await SendPasswordSetupEmailAsync(user, role);
                passwordSetupEmailSent = true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send password setup email to {Email}. Rolling back the new account.", user.Email);
                var deleteResult = await _userManager.DeleteAsync(user);

                if (!deleteResult.Succeeded)
                {
                    _logger.LogCritical(
                        "Failed to roll back user {UserId} after the password setup email failed. Errors: {Errors}",
                        user.Id,
                        string.Join(", ", deleteResult.Errors.Select(error => error.Description)));
                }

                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    message = "User was not created because the password setup email could not be sent. Check the email configuration and try again."
                });
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
                PasswordSetupEmailSent = passwordSetupEmailSent,
                Role = role
            });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = role == ApplicationRoles.Customer
                ? "Customer registered. Please confirm your email before signing in."
                : passwordSetupEmailSent
                    ? $"{role} user created and a password setup email was sent to {user.Email}."
                    : $"{role} user registered successfully.",
            userId = user.Id,
            email = user.Email,
            restaurantId = user.RestaurantId,
            emailConfirmed = user.EmailConfirmed,
            confirmationEmailSent,
            passwordSetupEmailSent,
            role
        });
    }

    private async Task SendPasswordSetupEmailAsync(ApplicationUser user, string role)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send a password setup link.");
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        var passwordSetupUrl = BuildPasswordResetUrl(user.Id, token);

        await SendLayoutEmailAsync(
            user.Email,
            "Set up your DineFlow password",
            new TransactionalEmail(
                Heading: "Set up your password",
                Paragraphs:
                [
                    $"An administrator created a {role} account for you on DineFlow.",
                    "Choose a password using the secure link below to finish setting it up."
                ],
                ActionLabel: "Set up password",
                ActionUrl: passwordSetupUrl,
                Footnotes:
                [
                    "This link expires in one hour.",
                    "If you were not expecting this invitation, you can ignore this email."
                ]));
    }

    /// <summary>Renders through the shared shell so every DineFlow email looks like the same sender.</summary>
    private Task SendLayoutEmailAsync(string recipient, string subject, TransactionalEmail email) =>
        _emailSender.SendAsync(
            recipient,
            subject,
            _emailLayout.RenderHtml(email),
            _emailLayout.RenderText(email));

    /// <summary>"one hour", "30 minutes" — so the copy cannot drift from the configured window.</summary>
    private static string DescribeDuration(TimeSpan duration)
    {
        if (duration.TotalMinutes < 60)
        {
            var minutes = (int)Math.Round(duration.TotalMinutes);
            return $"{minutes} minute{(minutes == 1 ? string.Empty : "s")}";
        }

        var hours = (int)Math.Round(duration.TotalHours);
        return hours == 1 ? "one hour" : $"{hours} hours";
    }

    private async Task SendConfirmationEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send confirmation email.");
        }

        var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
        var confirmationUrl = BuildConfirmationUrl(user.Id, token);

        await SendLayoutEmailAsync(
            user.Email,
            "Confirm your email address",
            new TransactionalEmail(
                Heading: "Confirm your email address",
                Paragraphs:
                [
                    $"An account was created for {user.Email} on DineFlow, where you can order from "
                        + "restaurants that use the platform.",
                    "Confirming the address finishes setting up the account and lets us send you "
                        + "order confirmations and receipts."
                ],
                ActionLabel: "Confirm email address",
                ActionUrl: confirmationUrl,
                Footnotes:
                [
                    $"This link expires in {DescribeDuration(UnconfirmedCustomerCleanupService.ConfirmationWindow)}. "
                        + "Until then you can send yourself a new one by trying to sign in.",
                    "After that the unconfirmed account is removed automatically, and you would "
                        + "need to sign up again.",
                    "If you did not create this account, no action is needed."
                ]));
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

        await SendLayoutEmailAsync(
            user.Email,
            "Sign in to DineFlow",
            new TransactionalEmail(
                Heading: "Sign in to DineFlow",
                Paragraphs: ["Use the secure link below to sign in. No password is needed."],
                ActionLabel: "Sign in to DineFlow",
                ActionUrl: magicLinkUrl,
                Footnotes:
                [
                    "This link expires in one hour and can only be used once.",
                    "If you did not ask to sign in, you can ignore this email — nobody can use the "
                        + "link without access to this inbox."
                ]));
    }

    private async Task SendPasswordResetEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send a password reset link.");
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(user);
        var passwordResetUrl = BuildPasswordResetUrl(user.Id, token);

        await SendLayoutEmailAsync(
            user.Email,
            "Reset your DineFlow password",
            new TransactionalEmail(
                Heading: "Reset your password",
                Paragraphs: ["Use the secure link below to choose a new password for your account."],
                ActionLabel: "Reset password",
                ActionUrl: passwordResetUrl,
                Footnotes:
                [
                    "This link expires in one hour.",
                    "If you did not ask to reset your password, you can ignore this email — your "
                        + "current password still works."
                ]));
    }

    /// <summary>
    /// Tells the address being replaced what is happening to it.
    ///
    /// <para>
    /// Sent twice, because the two moments say different things: when the change is requested it is
    /// a warning that can still be acted on, and when it completes it is the record that the account
    /// has moved. Someone who did not ask for either needs the first one most.
    /// </para>
    ///
    /// <para>
    /// The new address is shown in full rather than masked: the reader is the account holder, and
    /// hiding where their account went would leave them nothing to report.
    /// </para>
    /// </summary>
    private async Task TrySendEmailChangeNoticeAsync(string previousEmail, string newEmail, bool alreadyChanged)
    {
        if (string.IsNullOrWhiteSpace(previousEmail))
        {
            return;
        }

        var heading = alreadyChanged ? "Your email address was changed" : "Someone asked to change your email address";
        var opening = alreadyChanged
            ? $"The email address on your DineFlow account was changed from {previousEmail} to {newEmail}."
            : $"A request was made to change the email address on your DineFlow account from "
                + $"{previousEmail} to {newEmail}.";
        var consequence = alreadyChanged
            ? "You have been signed out everywhere, and this address can no longer be used to sign in."
            : "Nothing has changed yet. The change only takes effect once the new address is confirmed.";

        // Only offered before the change lands. Afterwards a reset link would be sent to the new
        // address — telling the person reading this to reset their password would send them chasing
        // a link that arrives in someone else's inbox.
        var footnotes = alreadyChanged
            ?
            [
                "If you made this change, nothing further is needed and you can ignore this email.",
                "If you did not, contact us at the support address below straight away. A password "
                    + "reset will no longer reach this inbox."
            ]
            : new[]
            {
                "If you made this change, nothing further is needed and you can ignore this email.",
                "If you did not, reset your password now — whoever made the request has access to "
                    + "the account."
            };

        try
        {
            await SendLayoutEmailAsync(
                previousEmail,
                alreadyChanged ? "Your DineFlow email address was changed" : "Email address change requested",
                new TransactionalEmail(
                    Heading: heading,
                    Paragraphs: [opening, consequence],
                    ActionLabel: alreadyChanged ? null : "Reset your password",
                    ActionUrl: alreadyChanged ? null : BuildFrontendUrl("/forgot-password"),
                    Footnotes: footnotes));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to notify {Email} that its account address is changing.", previousEmail);
        }
    }

    private async Task SendEmailChangeConfirmationAsync(ApplicationUser user, string newEmail)
    {
        var token = await _userManager.GenerateChangeEmailTokenAsync(user, newEmail);
        var emailChangeUrl = BuildEmailChangeUrl(user.Id, newEmail, token);

        await SendLayoutEmailAsync(
            newEmail,
            "Confirm your new DineFlow email",
            new TransactionalEmail(
                Heading: "Confirm your new email address",
                Paragraphs:
                [
                    // Naming both addresses is what lets the reader tell an expected change from
                    // someone trying to move an account they do not own onto this inbox.
                    $"A request was made to change the email address on the DineFlow account "
                        + $"{user.Email} to {newEmail}.",
                    "Confirm the address below to complete the change. Until then the account keeps "
                        + $"its current address, {user.Email}."
                ],
                ActionLabel: "Confirm new email address",
                ActionUrl: emailChangeUrl,
                Footnotes:
                [
                    "This link expires in one hour.",
                    "Confirming signs you out everywhere, so any other device will ask you to sign "
                        + "in again with the new address.",
                    "If you did not request this change, you can ignore this email — the account "
                        + "keeps its current address."
                ]));
    }

    private async Task SendMfaLoginCodeEmailAsync(ApplicationUser user, string code)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            throw new InvalidOperationException("User email is required to send an MFA code.");
        }

        await SendLayoutEmailAsync(
            user.Email,
            "Your DineFlow verification code",
            new TransactionalEmail(
                Heading: "Your verification code",
                Paragraphs:
                [
                    "Use this code to finish signing in to DineFlow:",
                    code
                ],
                Footnotes:
                [
                    "This code expires in five minutes.",
                    "If you did not try to sign in, someone may know your password — change it as "
                        + "soon as you can. Nobody can use this code without it."
                ]));
    }

    /// <summary>
    /// Lockout tells the caller the account exists, which is unavoidable — the alternative is
    /// leaving the person locked out with no idea why. It carries the wait so a legitimate owner
    /// knows when to come back, and Retry-After so clients can back off without polling.
    /// </summary>
    private IActionResult LockedOutResponse(DateTimeOffset? lockoutEnd)
    {
        var remaining = lockoutEnd is null
            ? TimeSpan.Zero
            : lockoutEnd.Value - DateTimeOffset.UtcNow;
        var remainingMinutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));

        Response.Headers.RetryAfter = ((int)Math.Max(1, Math.Ceiling(remaining.TotalSeconds)))
            .ToString(CultureInfo.InvariantCulture);

        return StatusCode(StatusCodes.Status423Locked, new
        {
            message = $"Too many failed sign-in attempts. Try again in {remainingMinutes} minute"
                + (remainingMinutes == 1 ? "." : "s."),
            code = "account_locked",
            lockoutEnd
        });
    }

    private async Task<IActionResult> BuildAuthenticatedResponseAsync(ApplicationUser user, string message)
    {
        user.LastLoginAt = DateTime.UtcNow;
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
            },
            actorOverride: ReportActor.User(
                user.Id,
                user.FullName ?? user.Email ?? "DineFlow user",
                user.Email,
                roles),
            correlationId: user.Id);
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

    private static bool HasCurrentOAuthLegalConsent(AuthenticationProperties? properties) =>
        properties is not null &&
        properties.Items.TryGetValue("customerTermsVersion", out var termsVersion) &&
        properties.Items.TryGetValue("privacyPolicyVersion", out var privacyVersion) &&
        termsVersion == LegalDocumentVersions.CustomerTerms &&
        privacyVersion == LegalDocumentVersions.PrivacyPolicy;

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

    private async Task<IActionResult?> CreateMfaLoginChallengeIfRequiredAsync(
        ApplicationUser user,
        CancellationToken cancellationToken)
    {
        var mfaSettings = await _dbContext.UserMfaSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(
                settings => settings.UserId == user.Id,
                cancellationToken);

        if (mfaSettings is null ||
            !mfaSettings.RequireForLogin ||
            (!mfaSettings.TotpEnabled && !mfaSettings.EmailEnabled))
        {
            return null;
        }

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

    /// <summary>Where the external sign-in should hand the customer back, kept in the auth state.</summary>
    private const string ExternalReturnToKey = "returnTo";

    /// <summary>
    /// The <c>&amp;returnTo=…</c> to append to the frontend callback, or an empty string.
    /// </summary>
    /// <remarks>
    /// Re-sanitised on the way out. The value has been round-tripped through the provider by now,
    /// so it is treated as arriving from outside however it was checked on the way in.
    /// </remarks>
    private static string BuildExternalReturnToQuery(AuthenticationProperties? properties)
    {
        if (properties?.Items is null ||
            !properties.Items.TryGetValue(ExternalReturnToKey, out var stored))
        {
            return string.Empty;
        }

        var safe = OAuthReturnPath.Sanitize(stored);

        return safe is null ? string.Empty : $"&returnTo={Uri.EscapeDataString(safe)}";
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
