using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-002. Anonymous credential endpoints must be throttled and must count failures against the
/// account. These assert the wiring, which is what silently regresses when an endpoint is added.
/// </summary>
public sealed class AuthenticationHardeningTests
{
    public static TheoryData<Type, string, string> ThrottledEndpoints => new()
    {
        { typeof(AuthController), "Login", RateLimitPolicies.Authentication },
        { typeof(AuthController), "MagicLinkLogin", RateLimitPolicies.Authentication },
        { typeof(AuthController), "Refresh", RateLimitPolicies.TokenLifecycle },
        { typeof(AuthController), "ExchangeOAuthCode", RateLimitPolicies.Authentication },
        { typeof(AuthController), "ResetPassword", RateLimitPolicies.Authentication },
        { typeof(AuthController), "ConfirmEmail", RateLimitPolicies.Authentication },
        { typeof(AuthController), "RequestMagicLink", RateLimitPolicies.AuthenticationEmail },
        { typeof(AuthController), "RequestPasswordReset", RateLimitPolicies.AuthenticationEmail },
        { typeof(AuthController), "ResendConfirmationEmail", RateLimitPolicies.AuthenticationEmail },
        { typeof(MfaController), "VerifyLogin", RateLimitPolicies.Authentication },
        { typeof(PasskeysController), "LoginOptions", RateLimitPolicies.Authentication },
        { typeof(PasskeysController), "LoginComplete", RateLimitPolicies.Authentication },
    };

    [Theory]
    [MemberData(nameof(ThrottledEndpoints))]
    public void AnonymousCredentialEndpoints_CarryARateLimitPolicy(
        Type controller,
        string methodName,
        string expectedPolicy)
    {
        var method = controller.GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance);
        Assert.NotNull(method);

        var attribute = method!.GetCustomAttribute<EnableRateLimitingAttribute>();

        Assert.NotNull(attribute);
        Assert.Equal(expectedPolicy, attribute!.PolicyName);
    }

    [Fact]
    public void EveryAnonymousPostOnTheAuthControllers_IsThrottled()
    {
        // Catches the next anonymous endpoint someone adds without a policy, rather than relying
        // on the fixed list above staying current.
        var unthrottled = new[] { typeof(AuthController), typeof(MfaController), typeof(PasskeysController) }
            .SelectMany(controller => controller.GetMethods(BindingFlags.Public | BindingFlags.Instance))
            .Where(method => method.GetCustomAttribute<Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute>() is not null)
            .Where(method => method.GetCustomAttribute<HttpPostAttribute>() is not null)
            .Where(method => method.GetCustomAttribute<EnableRateLimitingAttribute>() is null)
            .Select(method => $"{method.DeclaringType!.Name}.{method.Name}")
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Empty(unthrottled);
    }

    [Fact]
    public void LoginCountsFailuresAgainstTheAccount()
    {
        // The per-IP limiter cannot see an attacker rotating addresses; lockoutOnFailure is what
        // makes a single account expensive to guess at.
        var source = ReadControllerSource("AuthController.cs");
        var loginBody = ExtractMethodBody(source, "public async Task<IActionResult> Login(LoginRequest request)");

        Assert.Contains("lockoutOnFailure: true", loginBody, StringComparison.Ordinal);
        Assert.Contains("result.IsLockedOut", loginBody, StringComparison.Ordinal);
    }

    [Fact]
    public void MfaVerificationCountsFailuresAgainstTheAccount()
    {
        var source = ReadControllerSource("MfaController.cs");

        Assert.Contains("AccessFailedAsync", source, StringComparison.Ordinal);
        Assert.Contains("IsLockedOutAsync", source, StringComparison.Ordinal);
    }

    [Fact]
    public void MagicLinkRedemptionCountsFailuresAgainstTheAccount()
    {
        var source = ReadControllerSource("AuthController.cs");
        var body = ExtractMethodBody(source, "public async Task<IActionResult> MagicLinkLogin(");

        Assert.Contains("IsLockedOutAsync", body, StringComparison.Ordinal);
        Assert.Contains("AccessFailedAsync", body, StringComparison.Ordinal);
    }

    private static string ReadControllerSource(string fileName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        var path = Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", fileName);
        Assert.True(File.Exists(path), $"Controller source not found at {path}.");

        return File.ReadAllText(path);
    }

    private static string ExtractMethodBody(string source, string signature)
    {
        var start = source.IndexOf(signature, StringComparison.Ordinal);
        Assert.True(start >= 0, $"Method '{signature}' was not found.");

        // Far enough to cover the guard clauses at the top of the method without parsing C#.
        var length = Math.Min(2_500, source.Length - start);
        return source.Substring(start, length);
    }
}
