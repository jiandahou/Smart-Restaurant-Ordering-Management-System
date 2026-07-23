using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Guards the authorization contract of <see cref="OrderController"/> so the fix for the
/// unauthenticated order-listing endpoints cannot silently regress. Reflection-based so it
/// needs no database or app host.
/// </summary>
public class OrderAuthorizationContractTests
{
    [Theory]
    [InlineData(nameof(OrderController.GetOrders), AuthorizationPolicies.PlatformOwnerOnly)]
    [InlineData(nameof(OrderController.GetOrder), AuthorizationPolicies.AdminApi)]
    [InlineData(nameof(OrderController.GetMyOrders), null)]
    public void ProtectedEndpoints_RequireAuthorization_WithExpectedPolicy(
        string methodName,
        string? expectedPolicy)
    {
        var method = GetAction(methodName);
        var authorize = method.GetCustomAttribute<AuthorizeAttribute>();

        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.NotNull(authorize);
        Assert.Equal(expectedPolicy, authorize!.Policy);
    }

    [Theory]
    [InlineData(nameof(OrderController.GetGuestOrders))]
    [InlineData(nameof(OrderController.CreateRefundRequest))]
    public void PublicEndpoints_StayAnonymous(string methodName)
    {
        var method = GetAction(methodName);
        Assert.NotNull(method.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    private static MethodInfo GetAction(string methodName)
    {
        var method = typeof(OrderController).GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance);
        Assert.NotNull(method);
        return method!;
    }
}
