using System.Security.Claims;
using System.Text.Encodings.Web;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Common;
using DineFlow.Api.Contracts.Users;
using DineFlow.Api.Extensions;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class UsersController : ControllerBase
{
    /// <summary>
    /// Lockout date used to mean "disabled". Far enough out to be permanent in practice, and
    /// distinguishable from the short lockouts Identity applies after failed sign-ins.
    /// </summary>
    private static readonly DateTimeOffset DisabledLockoutEnd = new(9999, 12, 31, 0, 0, 0, TimeSpan.Zero);

    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AppDbContext _dbContext;
    private readonly ReportLogWriter _reportLogWriter;
    private readonly IEmailSender _emailSender;
    private readonly EmailOptions _emailOptions;

    public UsersController(
        UserManager<ApplicationUser> userManager,
        AppDbContext dbContext,
        ReportLogWriter reportLogWriter,
        IEmailSender emailSender,
        IOptions<EmailOptions> emailOptions)
    {
        _userManager = userManager;
        _dbContext = dbContext;
        _reportLogWriter = reportLogWriter;
        _emailSender = emailSender;
        _emailOptions = emailOptions.Value;
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpGet("users")]
    public Task<ActionResult<PagedResponse<UserListResponse>>> GetUsers(
        [FromQuery] UserListRequest request,
        CancellationToken cancellationToken)
    {
        return BuildUserListResponseAsync(_userManager.Users.AsNoTracking(), request, cancellationToken);
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpGet("restaurants/{restaurantId:guid}/users")]
    public Task<ActionResult<PagedResponse<UserListResponse>>> GetRestaurantUsers(
        Guid restaurantId,
        [FromQuery] UserListRequest request,
        CancellationToken cancellationToken)
    {
        var query = _userManager.Users.Where(user => user.RestaurantId == restaurantId);

        return BuildUserListResponseAsync(query.AsNoTracking(), request, cancellationToken);
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("restaurant/users")]
    public async Task<ActionResult<PagedResponse<UserListResponse>>> GetCurrentRestaurantUsers(
        [FromQuery] UserListRequest request,
        CancellationToken cancellationToken)
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return await BuildUserListResponseAsync(_userManager.Users.AsNoTracking(), request, cancellationToken);
        }

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (string.IsNullOrWhiteSpace(currentUserId))
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        var currentUser = await _userManager.FindByIdAsync(currentUserId);

        if (currentUser?.RestaurantId is null)
        {
            return BadRequest(new
            {
                message = "Current user is not assigned to a restaurant."
            });
        }

        var query = _userManager.Users.Where(user => user.RestaurantId == currentUser.RestaurantId);

        return await BuildUserListResponseAsync(query.AsNoTracking(), request, cancellationToken);
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPut("users/{userId}")]
    public async Task<IActionResult> UpdateUser(string userId, UpdateUserRequest request)
    {
        var currentUser = await GetCurrentUserAsync();

        if (currentUser is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        if (currentUser.Id == userId)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Use the profile flow to update your own account."
            });
        }

        var targetUser = await _userManager.FindByIdAsync(userId);

        if (targetUser is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        var currentRoles = await _userManager.GetRolesAsync(currentUser);
        var targetRoles = await _userManager.GetRolesAsync(targetUser);
        var currentRank = GetHighestRank(currentRoles);
        var targetRank = GetHighestRank(targetRoles);
        var beforeUser = new
        {
            targetUser.Email,
            targetUser.FullName,
            targetUser.RestaurantId,
            Roles = targetRoles.OrderBy(role => role, StringComparer.OrdinalIgnoreCase).ToArray()
        };

        if (currentRank <= targetRank)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "You can only update users with lower permissions than your own."
            });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            if (currentUser.RestaurantId is null || targetUser.RestaurantId != currentUser.RestaurantId)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "You can only update users in your restaurant."
                });
            }
        }

        var nextRole = string.IsNullOrWhiteSpace(request.Role)
            ? targetRoles.FirstOrDefault()
            : request.Role.Trim();

        if (string.IsNullOrWhiteSpace(nextRole) || !ApplicationRoles.ManagedRoles.Contains(nextRole))
        {
            return BadRequest(new
            {
                message = "Role must be RestaurantOwner, Admin, Staff, or Customer."
            });
        }

        var nextRoleRank = ApplicationRoles.RoleRanks[nextRole];

        if (currentRank <= nextRoleRank)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "You can only assign roles with lower permissions than your own."
            });
        }

        var nextRestaurantId = User.IsInRole(ApplicationRoles.PlatformOwner)
            ? request.RestaurantId ?? targetUser.RestaurantId
            : currentUser.RestaurantId;

        if (nextRole == ApplicationRoles.Customer)
        {
            nextRestaurantId = null;
        }

        if (nextRole != ApplicationRoles.Customer && nextRestaurantId is null)
        {
            return BadRequest(new
            {
                message = "RestaurantId is required for managed restaurant users."
            });
        }

        var nextEmail = string.IsNullOrWhiteSpace(request.Email)
            ? targetUser.Email
            : request.Email.Trim();

        if (string.IsNullOrWhiteSpace(nextEmail))
        {
            return BadRequest(new
            {
                message = "Email is required."
            });
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync();

        if (!string.Equals(targetUser.Email, nextEmail, StringComparison.OrdinalIgnoreCase))
        {
            var existingUser = await _userManager.FindByEmailAsync(nextEmail);

            if (existingUser is not null && existingUser.Id != targetUser.Id)
            {
                return BadRequest(new
                {
                    message = "Email is already in use."
                });
            }

            var emailResult = await _userManager.SetEmailAsync(targetUser, nextEmail);

            if (!emailResult.Succeeded)
            {
                return BadRequest(new
                {
                    message = "Failed to update email.",
                    errors = emailResult.Errors
                });
            }

            var userNameResult = await _userManager.SetUserNameAsync(targetUser, nextEmail);

            if (!userNameResult.Succeeded)
            {
                return BadRequest(new
                {
                    message = "Failed to update username.",
                    errors = userNameResult.Errors
                });
            }
        }

        if (!string.IsNullOrWhiteSpace(request.FullName))
        {
            targetUser.FullName = request.FullName.Trim();
        }

        targetUser.RestaurantId = nextRestaurantId;
        targetUser.UpdatedAt = DateTime.UtcNow;

        var updateResult = await _userManager.UpdateAsync(targetUser);

        if (!updateResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to update user.",
                errors = updateResult.Errors
            });
        }

        if (!targetRoles.Contains(nextRole))
        {
            var removeRolesResult = await _userManager.RemoveFromRolesAsync(targetUser, targetRoles);

            if (!removeRolesResult.Succeeded)
            {
                return BadRequest(new
                {
                    message = "Failed to update user role.",
                    errors = removeRolesResult.Errors
                });
            }

            var addRoleResult = await _userManager.AddToRoleAsync(targetUser, nextRole);

            if (!addRoleResult.Succeeded)
            {
                return BadRequest(new
                {
                    message = "Failed to update user role.",
                    errors = addRoleResult.Errors
                });
            }
        }

        if (!string.IsNullOrWhiteSpace(request.Password))
        {
            var passwordResetToken = await _userManager.GeneratePasswordResetTokenAsync(targetUser);
            var passwordResult = await _userManager.ResetPasswordAsync(
                targetUser,
                passwordResetToken,
                request.Password);

            if (!passwordResult.Succeeded)
            {
                return BadRequest(new
                {
                    message = "Failed to update password.",
                    errors = passwordResult.Errors
                });
            }
        }

        var updatedRoles = await _userManager.GetRolesAsync(targetUser);

        _reportLogWriter.AddAudit(
            "Admin.UserUpdated",
            "User",
            targetUser.Id,
            targetUser.RestaurantId,
            $"Updated user {targetUser.Email}.",
            beforeUser,
            new
            {
                targetUser.Email,
                targetUser.FullName,
                targetUser.RestaurantId,
                Roles = updatedRoles.OrderBy(role => role, StringComparer.OrdinalIgnoreCase).ToArray(),
                PasswordChanged = !string.IsNullOrWhiteSpace(request.Password)
            });
        await _dbContext.SaveChangesAsync();

        await transaction.CommitAsync();

        return Ok(new
        {
            message = "User updated successfully.",
            user = new
            {
                id = targetUser.Id,
                email = targetUser.Email,
                fullName = targetUser.FullName,
                avatarUrl = targetUser.AvatarUrl,
                restaurantId = targetUser.RestaurantId,
                createdAt = targetUser.CreatedAt,
                updatedAt = targetUser.UpdatedAt,
                roles = updatedRoles
            }
        });
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpDelete("users/{userId}")]
    public async Task<IActionResult> DeleteUser(string userId)
    {
        var currentUser = await GetCurrentUserAsync();

        if (currentUser is null)
        {
            return Unauthorized(new
            {
                message = "Invalid token."
            });
        }

        if (currentUser.Id == userId)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "You cannot delete your own account."
            });
        }

        var targetUser = await _userManager.FindByIdAsync(userId);

        if (targetUser is null)
        {
            return NotFound(new
            {
                message = "User not found."
            });
        }

        var currentRoles = await _userManager.GetRolesAsync(currentUser);
        var targetRoles = await _userManager.GetRolesAsync(targetUser);
        var currentRank = GetHighestRank(currentRoles);
        var targetRank = GetHighestRank(targetRoles);
        var deletedUser = new
        {
            targetUser.Id,
            targetUser.Email,
            targetUser.FullName,
            targetUser.RestaurantId,
            Roles = targetRoles.OrderBy(role => role, StringComparer.OrdinalIgnoreCase).ToArray()
        };

        if (currentRank <= targetRank)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "You can only delete users with lower permissions than your own."
            });
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            if (currentUser.RestaurantId is null || targetUser.RestaurantId != currentUser.RestaurantId)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    message = "You can only delete users in your restaurant."
                });
            }
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync();

        var deleteResult = await _userManager.DeleteAsync(targetUser);

        if (!deleteResult.Succeeded)
        {
            return BadRequest(new
            {
                message = "Failed to delete user.",
                errors = deleteResult.Errors
            });
        }

        _reportLogWriter.AddAudit(
            "Admin.UserDeleted",
            "User",
            targetUser.Id,
            targetUser.RestaurantId,
            $"Deleted user {deletedUser.Email}.",
            deletedUser);
        await _dbContext.SaveChangesAsync();

        await transaction.CommitAsync();

        return Ok(new
        {
            message = "User deleted successfully.",
            userId = targetUser.Id
        });
    }

    /// <summary>
    /// Disables or re-enables an account. Disabling parks the Identity lockout far in the future
    /// rather than deleting the row, so audit entries that reference the user stay resolvable.
    /// </summary>
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPatch("users/{userId}/status")]
    public async Task<IActionResult> UpdateUserStatus(string userId, UpdateUserStatusRequest request)
    {
        var resolution = await ResolveManageableTargetAsync(userId, "change the status of");

        if (resolution.Error is not null)
        {
            return resolution.Error;
        }

        var targetUser = resolution.TargetUser!;
        var before = new { targetUser.Id, targetUser.Email, targetUser.LockoutEnd };

        if (request.IsDisabled && !targetUser.LockoutEnabled)
        {
            // Lockout must be switched on for the end date to have any effect.
            await _userManager.SetLockoutEnabledAsync(targetUser, true);
        }

        var result = await _userManager.SetLockoutEndDateAsync(
            targetUser,
            request.IsDisabled ? DisabledLockoutEnd : null);

        if (!result.Succeeded)
        {
            return BadRequest(new { message = "Failed to change the account status.", errors = result.Errors });
        }

        if (!request.IsDisabled)
        {
            // Re-enabling also clears the failed sign-in counter, otherwise the next mistake
            // immediately re-locks the account.
            await _userManager.ResetAccessFailedCountAsync(targetUser);
        }

        _reportLogWriter.AddAudit(
            request.IsDisabled ? "Admin.UserDisabled" : "Admin.UserEnabled",
            "User",
            targetUser.Id,
            targetUser.RestaurantId,
            request.IsDisabled ? $"Disabled {targetUser.Email}." : $"Enabled {targetUser.Email}.",
            before,
            new { targetUser.Id, targetUser.Email, targetUser.LockoutEnd });
        await _dbContext.SaveChangesAsync();

        return Ok(new
        {
            message = request.IsDisabled ? "Account disabled." : "Account enabled.",
            userId = targetUser.Id,
            isDisabled = request.IsDisabled
        });
    }

    /// <summary>
    /// Clears a temporary lockout caused by failed sign-ins. Distinct from enabling a deliberately
    /// disabled account, though both end up clearing the lockout date.
    /// </summary>
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("users/{userId}/unlock")]
    public async Task<IActionResult> UnlockUser(string userId)
    {
        var resolution = await ResolveManageableTargetAsync(userId, "unlock");

        if (resolution.Error is not null)
        {
            return resolution.Error;
        }

        var targetUser = resolution.TargetUser!;
        var before = new { targetUser.Id, targetUser.Email, targetUser.LockoutEnd, targetUser.AccessFailedCount };

        await _userManager.SetLockoutEndDateAsync(targetUser, null);
        await _userManager.ResetAccessFailedCountAsync(targetUser);

        _reportLogWriter.AddAudit(
            "Admin.UserUnlocked",
            "User",
            targetUser.Id,
            targetUser.RestaurantId,
            $"Unlocked {targetUser.Email}.",
            before,
            new { targetUser.Id, targetUser.Email, targetUser.LockoutEnd, targetUser.AccessFailedCount });
        await _dbContext.SaveChangesAsync();

        return Ok(new { message = "Account unlocked.", userId = targetUser.Id });
    }

    /// <summary>
    /// Emails the user a reset link. Preferable to an admin typing a password and reading it out:
    /// the admin never learns the credential and the link expires on its own.
    /// </summary>
    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpPost("users/{userId}/send-password-reset")]
    public async Task<IActionResult> SendPasswordReset(string userId)
    {
        var resolution = await ResolveManageableTargetAsync(userId, "send a password reset for");

        if (resolution.Error is not null)
        {
            return resolution.Error;
        }

        var targetUser = resolution.TargetUser!;

        if (string.IsNullOrWhiteSpace(targetUser.Email))
        {
            return BadRequest(new { message = "This account has no email address to send a reset link to." });
        }

        var token = await _userManager.GeneratePasswordResetTokenAsync(targetUser);
        var resetUrl = BuildPasswordResetUrl(targetUser.Id, token);

        await _emailSender.SendAsync(
            targetUser.Email,
            "Reset your DineFlow password",
            $"""
            <p>An administrator asked us to help you reset your DineFlow password.</p>
            <p>This link expires in one hour.</p>
            <p><a href="{HtmlEncoder.Default.Encode(resetUrl)}">Reset password</a></p>
            """,
            $"Reset your DineFlow password: {resetUrl}");

        _reportLogWriter.AddAudit(
            "Admin.PasswordResetSent",
            "User",
            targetUser.Id,
            targetUser.RestaurantId,
            $"Sent a password reset link to {targetUser.Email}.",
            after: new { targetUser.Id, targetUser.Email });
        await _dbContext.SaveChangesAsync();

        return Ok(new { message = $"Password reset link sent to {targetUser.Email}.", userId = targetUser.Id });
    }

    /// <summary>
    /// Shared guard for the per-user admin actions: the caller must outrank the target, cannot act
    /// on themselves, and outside PlatformOwner must stay inside their own restaurant.
    /// </summary>
    private async Task<(ApplicationUser? TargetUser, IActionResult? Error)> ResolveManageableTargetAsync(
        string userId,
        string actionDescription)
    {
        var currentUser = await GetCurrentUserAsync();

        if (currentUser is null)
        {
            return (null, Unauthorized(new { message = "Invalid token." }));
        }

        if (currentUser.Id == userId)
        {
            return (null, StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = $"You cannot {actionDescription} your own account."
            }));
        }

        var targetUser = await _userManager.FindByIdAsync(userId);

        if (targetUser is null)
        {
            return (null, NotFound(new { message = "User not found." }));
        }

        var currentRank = GetHighestRank(await _userManager.GetRolesAsync(currentUser));
        var targetRank = GetHighestRank(await _userManager.GetRolesAsync(targetUser));

        if (currentRank <= targetRank)
        {
            return (null, StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = $"You can only {actionDescription} users with lower permissions than your own."
            }));
        }

        if (!User.IsInRole(ApplicationRoles.PlatformOwner) &&
            (currentUser.RestaurantId is null || targetUser.RestaurantId != currentUser.RestaurantId))
        {
            return (null, StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = $"You can only {actionDescription} users in your restaurant."
            }));
        }

        return (targetUser, null);
    }

    private string BuildPasswordResetUrl(string userId, string token)
    {
        var baseUrl = string.IsNullOrWhiteSpace(_emailOptions.FrontendBaseUrl)
            ? "http://localhost:5173"
            : _emailOptions.FrontendBaseUrl.TrimEnd('/');

        return $"{baseUrl}/reset-password?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}";
    }

    private async Task<ActionResult<PagedResponse<UserListResponse>>> BuildUserListResponseAsync(
        IQueryable<ApplicationUser> query,
        UserListRequest request,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(request.Role))
        {
            var role = ApplicationRoles.All.FirstOrDefault(candidate =>
                candidate.Equals(request.Role.Trim(), StringComparison.OrdinalIgnoreCase));

            if (role is null)
            {
                return BadRequest(new
                {
                    message = $"Unsupported Role value. Allowed values: {string.Join(", ", ApplicationRoles.All)}."
                });
            }

            var normalizedRole = role.ToUpperInvariant();
            query = query.Where(user =>
                _dbContext.UserRoles.Any(userRole =>
                    userRole.UserId == user.Id &&
                    _dbContext.Roles.Any(identityRole =>
                        identityRole.Id == userRole.RoleId && identityRole.NormalizedName == normalizedRole)));
        }

        if (request.RestaurantId.HasValue)
        {
            query = query.Where(user => user.RestaurantId == request.RestaurantId);
        }

        var normalizedAudience = string.IsNullOrWhiteSpace(request.Audience)
            ? "all"
            : request.Audience.Trim().ToLowerInvariant();

        if (normalizedAudience is "staff" or "customers")
        {
            var staffRoleNames = ApplicationRoles.All
                .Where(role => !role.Equals(ApplicationRoles.Customer, StringComparison.OrdinalIgnoreCase))
                .Select(role => role.ToUpperInvariant())
                .ToList();

            var wantsStaff = normalizedAudience == "staff";
            query = query.Where(user => _dbContext.UserRoles.Any(userRole =>
                userRole.UserId == user.Id &&
                _dbContext.Roles.Any(identityRole =>
                    identityRole.Id == userRole.RoleId &&
                    identityRole.NormalizedName != null &&
                    staffRoleNames.Contains(identityRole.NormalizedName))) == wantsStaff);
        }
        else if (normalizedAudience != "all")
        {
            return BadRequest(new
            {
                message = "Unsupported Audience value. Allowed values: staff, customers, all."
            });
        }

        var normalizedScope = string.IsNullOrWhiteSpace(request.Scope)
            ? "all"
            : request.Scope.Trim().ToLowerInvariant();
        query = normalizedScope switch
        {
            "all" => query,
            "platform" => query.Where(user => user.RestaurantId == null),
            "restaurant" => query.Where(user => user.RestaurantId != null),
            _ => null!
        };

        if (query is null)
        {
            return BadRequest(new
            {
                message = "Unsupported Scope value. Allowed values: all, platform, restaurant."
            });
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = $"%{search}%";
            query = query.Where(user =>
                (user.FullName != null && EF.Functions.ILike(user.FullName, pattern)) ||
                (user.Email != null && EF.Functions.ILike(user.Email, pattern)) ||
                _dbContext.UserRoles.Any(userRole =>
                    userRole.UserId == user.Id &&
                    _dbContext.Roles.Any(identityRole =>
                        identityRole.Id == userRole.RoleId &&
                        identityRole.Name != null &&
                        EF.Functions.ILike(identityRole.Name, pattern))));
        }

        var now = DateTimeOffset.UtcNow;
        // A "disabled" account is a lockout parked far in the future; anything nearer is a
        // temporary lockout from failed sign-ins.
        var disabledThreshold = DisabledLockoutEnd.AddYears(-1);
        var normalizedStatus = string.IsNullOrWhiteSpace(request.Status)
            ? "all"
            : request.Status.Trim().ToLowerInvariant();

        query = normalizedStatus switch
        {
            "all" => query,
            "active" => query.Where(user => user.LockoutEnd == null || user.LockoutEnd <= now),
            "disabled" => query.Where(user => user.LockoutEnd != null && user.LockoutEnd >= disabledThreshold),
            "locked" => query.Where(user =>
                user.LockoutEnd != null &&
                user.LockoutEnd > now &&
                user.LockoutEnd < disabledThreshold),
            "unverified" => query.Where(user => !user.EmailConfirmed),
            "mfa" => query.Where(user => user.TwoFactorEnabled),
            _ => null!
        };

        if (query is null)
        {
            return BadRequest(new
            {
                message = "Unsupported Status value. Allowed values: all, active, disabled, locked, unverified, mfa."
            });
        }

        var sortedQuery = ApplySorting(query, request.SortBy, request.IsDescending);
        if (sortedQuery is null)
        {
            return BadRequest(new
            {
                message = "Unsupported sortBy value.",
                allowedValues = new[] { "fullName", "email", "restaurant", "role", "createdAt", "updatedAt" }
            });
        }

        var responseQuery = sortedQuery.Select(user => new UserListResponse
        {
            Id = user.Id,
            Email = user.Email,
            FullName = user.FullName,
            AvatarUrl = user.AvatarUrl,
            RestaurantId = user.RestaurantId,
            CreatedAt = user.CreatedAt,
            UpdatedAt = user.UpdatedAt,
            LastLoginAt = user.LastLoginAt,
            EmailConfirmed = user.EmailConfirmed,
            LockoutEnd = user.LockoutEnd,
            IsLockedOut = user.LockoutEnd != null && user.LockoutEnd > now,
            IsDisabled = user.LockoutEnd != null && user.LockoutEnd >= disabledThreshold,
            AccessFailedCount = user.AccessFailedCount,
            TwoFactorEnabled = user.TwoFactorEnabled,
            Roles = (from userRole in _dbContext.UserRoles
                     join identityRole in _dbContext.Roles on userRole.RoleId equals identityRole.Id
                     where userRole.UserId == user.Id && identityRole.Name != null
                     orderby identityRole.Name
                     select identityRole.Name!).ToList()
        });

        return Ok(await responseQuery.ToPagedResponseAsync(
            request.Page,
            request.PageSize,
            cancellationToken));
    }

    private IOrderedQueryable<ApplicationUser>? ApplySorting(
        IQueryable<ApplicationUser> query,
        string? sortBy,
        bool descending)
    {
        var normalizedSort = string.IsNullOrWhiteSpace(sortBy) ? "email" : sortBy.Trim();
        IOrderedQueryable<ApplicationUser>? sorted = normalizedSort.ToLowerInvariant() switch
        {
            "fullname" => descending ? query.OrderByDescending(user => user.FullName) : query.OrderBy(user => user.FullName),
            "email" => descending ? query.OrderByDescending(user => user.Email) : query.OrderBy(user => user.Email),
            "restaurant" => descending ? query.OrderByDescending(user => user.RestaurantId) : query.OrderBy(user => user.RestaurantId),
            "role" => descending
                ? query.OrderByDescending(user =>
                    (from userRole in _dbContext.UserRoles
                     join identityRole in _dbContext.Roles on userRole.RoleId equals identityRole.Id
                     where userRole.UserId == user.Id
                     orderby identityRole.Name
                     select identityRole.Name).FirstOrDefault())
                : query.OrderBy(user =>
                    (from userRole in _dbContext.UserRoles
                     join identityRole in _dbContext.Roles on userRole.RoleId equals identityRole.Id
                     where userRole.UserId == user.Id
                     orderby identityRole.Name
                     select identityRole.Name).FirstOrDefault()),
            "createdat" => descending ? query.OrderByDescending(user => user.CreatedAt) : query.OrderBy(user => user.CreatedAt),
            "updatedat" => descending ? query.OrderByDescending(user => user.UpdatedAt) : query.OrderBy(user => user.UpdatedAt),
            _ => null
        };

        return sorted is null
            ? null
            : descending
                ? sorted.ThenByDescending(user => user.Id)
                : sorted.ThenBy(user => user.Id);
    }

    private async Task<ApplicationUser?> GetCurrentUserAsync()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);

        return string.IsNullOrWhiteSpace(currentUserId)
            ? null
            : await _userManager.FindByIdAsync(currentUserId);
    }

    private static int GetHighestRank(IEnumerable<string> roles)
    {
        return roles
            .Where(ApplicationRoles.RoleRanks.ContainsKey)
            .Select(role => ApplicationRoles.RoleRanks[role])
            .DefaultIfEmpty(-1)
            .Max();
    }
}
