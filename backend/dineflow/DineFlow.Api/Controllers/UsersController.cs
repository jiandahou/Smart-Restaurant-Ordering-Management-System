using System.Security.Claims;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Users;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize(Policy = AuthorizationPolicies.AdminApi)]
public class UsersController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly AppDbContext _dbContext;

    public UsersController(UserManager<ApplicationUser> userManager, AppDbContext dbContext)
    {
        _userManager = userManager;
        _dbContext = dbContext;
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        return Ok(await BuildUserListResponseAsync(_userManager.Users));
    }

    [Authorize(Policy = AuthorizationPolicies.PlatformOwnerOnly)]
    [HttpGet("restaurants/{restaurantId:guid}/users")]
    public async Task<IActionResult> GetRestaurantUsers(Guid restaurantId)
    {
        var query = _userManager.Users.Where(user => user.RestaurantId == restaurantId);

        return Ok(await BuildUserListResponseAsync(query));
    }

    [Authorize(Policy = AuthorizationPolicies.AdminApi)]
    [HttpGet("restaurant/users")]
    public async Task<IActionResult> GetCurrentRestaurantUsers()
    {
        if (User.IsInRole(ApplicationRoles.PlatformOwner))
        {
            return Ok(await BuildUserListResponseAsync(_userManager.Users));
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

        return Ok(await BuildUserListResponseAsync(query));
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

        await transaction.CommitAsync();

        return Ok(new
        {
            message = "User deleted successfully.",
            userId = targetUser.Id
        });
    }

    private async Task<List<object>> BuildUserListResponseAsync(IQueryable<ApplicationUser> query)
    {
        var users = await query
            .OrderBy(user => user.Email)
            .ToListAsync();

        var response = new List<object>();

        foreach (var user in users)
        {
            var roles = await _userManager.GetRolesAsync(user);

            response.Add(new
            {
                id = user.Id,
                email = user.Email,
                fullName = user.FullName,
                avatarUrl = user.AvatarUrl,
                restaurantId = user.RestaurantId,
                createdAt = user.CreatedAt,
                updatedAt = user.UpdatedAt,
                roles
            });
        }

        return response;
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
