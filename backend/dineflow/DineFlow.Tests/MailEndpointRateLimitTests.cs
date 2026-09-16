using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Every endpoint that puts a message in somebody's inbox has to be throttled, because the abuse is
/// the mail itself rather than any secret it might leak.
///
/// <para>
/// The anonymous ones were: magic link, password reset and confirmation resend all carry
/// <see cref="RateLimitPolicies.AuthenticationEmail"/>. The two signed-in ones were not. Six calls
/// to <c>mfa/email/setup</c> sent six codes, and a seventh sent a seventh — an authenticated caller
/// could flood the account's own inbox, drown the security notices already sitting in it, burn the
/// provider quota and, by sending the same message over and over, damage the sending domain's
/// reputation for every other message DineFlow sends.
/// </para>
///
/// <para>
/// Asserting over the whole controller rather than the two known methods, so a mail-sending endpoint
/// added later cannot quietly arrive without a budget.
/// </para>
/// </summary>
public sealed class MailEndpointRateLimitTests
{
    /// Route templates, per controller, of every action that sends mail.
    public static TheoryData<Type, string, string> MailSendingEndpoints() => new()
    {
        { typeof(MfaController), "email/setup", RateLimitPolicies.SignedInEmail },
        { typeof(MfaController), "sensitive/email-code", RateLimitPolicies.SignedInEmail },
        { typeof(AuthController), "register-customer", RateLimitPolicies.AuthenticationEmail },
        { typeof(AuthController), "resend-confirmation-email", RateLimitPolicies.AuthenticationEmail },
        { typeof(AuthController), "request-magic-link", RateLimitPolicies.AuthenticationEmail },
        { typeof(AuthController), "request-password-reset", RateLimitPolicies.AuthenticationEmail },
    };

    [Theory]
    [MemberData(nameof(MailSendingEndpoints))]
    public void EveryMailSendingEndpoint_CarriesARateLimitPolicy(
        Type controller,
        string route,
        string expectedPolicy)
    {
        var action = FindAction(controller, route);
        Assert.NotNull(action);

        var limit = action!.GetCustomAttribute<EnableRateLimitingAttribute>();
        Assert.NotNull(limit);
        Assert.Equal(expectedPolicy, limit!.PolicyName);
    }

    /// The signed-in budget is counted per account, not per address: the recipient is fixed by the
    /// account, and staff sharing one outbound connection must not share one allowance.
    [Fact]
    public void SignedInMailPolicy_IsDistinctFromTheAnonymousOne()
        => Assert.NotEqual(RateLimitPolicies.AuthenticationEmail, RateLimitPolicies.SignedInEmail);

    private static MethodInfo? FindAction(Type controller, string route) => controller
        .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
        .FirstOrDefault(method => method
            .GetCustomAttributes<HttpPostAttribute>()
            .Any(post => string.Equals(post.Template, route, StringComparison.OrdinalIgnoreCase)));
}
