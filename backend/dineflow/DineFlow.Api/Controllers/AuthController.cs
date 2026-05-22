using DineFlow.Api.Contracts.Auth;
using DineFlow.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly UserManager<ApplicationUser> _userManager;
    private readonly SignInManager<ApplicationUser> _signInManager;

    public AuthController(
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        _userManager = userManager;
        _signInManager = signInManager;
    }

    [HttpPost("register-admin")]
    public async Task<IActionResult> RegisterAdmin(RegisterRequest request)
    {
        var existingUser = await _userManager.FindByEmailAsync(request.Email);

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

        if (!await _userManager.IsInRoleAsync(user, "Admin"))
        {
            await _userManager.AddToRoleAsync(user, "Admin");
        }

        return Ok(new
        {
            message = "Admin user registered successfully.",
            userId = user.Id,
            email = user.Email
        });
    }

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

        var roles = await _userManager.GetRolesAsync(user);

        return Ok(new
        {
            message = "Login successful.",
            user = new
            {
                id = user.Id,
                email = user.Email,
                fullName = user.FullName,
                roles
            }
        });
    }
}