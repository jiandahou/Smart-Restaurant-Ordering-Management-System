using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Contracts.Payments;
using DineFlow.Api.Controllers;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

public class PaymentSafetyContractTests
{
    [Theory]
    [InlineData(nameof(PaymentsController.GetPaymentEnvironment))]
    [InlineData(nameof(PaymentsController.ApproveRefundRequest))]
    [InlineData(nameof(PaymentsController.RejectRefundRequest))]
    public void PaymentAdministrationEndpoints_RequireAdminPolicy(string methodName)
    {
        var method = typeof(PaymentsController).GetMethod(methodName, BindingFlags.Public | BindingFlags.Instance);
        var authorize = method?.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(method);
        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.AdminApi, authorize!.Policy);
    }

    [Fact]
    public void RefundRequests_HaveAnAtomicProcessingState()
    {
        Assert.True(Enum.IsDefined(PaymentRefundRequestStatus.Processing));
        Assert.NotEqual(PaymentRefundRequestStatus.Pending, PaymentRefundRequestStatus.Processing);
    }

    [Fact]
    public void RefundProcessor_AcceptsARequestedAmountAndDeterministicIdempotencySeed()
    {
        var method = typeof(OrderRefundProcessor).GetMethod(nameof(OrderRefundProcessor.RefundAsync));
        var parameters = method?.GetParameters() ?? [];

        Assert.Contains(parameters, parameter =>
            parameter.Name == "idempotencyKeySeed" &&
            parameter.ParameterType == typeof(string));
        Assert.Contains(parameters, parameter =>
            parameter.Name == "requestedAmountCents" &&
            parameter.ParameterType == typeof(long?));
        Assert.Contains(parameters, parameter =>
            parameter.Name == "refundRequestId" &&
            parameter.ParameterType == typeof(Guid?));
    }

    [Fact]
    public void StripeProviderRefundId_HasUniqueDatabaseIndex()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"payment-safety-{Guid.NewGuid():N}")
            .Options;
        using var dbContext = new AppDbContext(options);

        var entity = dbContext.Model.FindEntityType(typeof(PaymentRefund));
        var index = entity?.GetIndexes().SingleOrDefault(candidate =>
            candidate.Properties.Count == 1 &&
            candidate.Properties[0].Name == nameof(PaymentRefund.ProviderRefundId));

        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
        Assert.Equal("\"ProviderRefundId\" IS NOT NULL", index.GetFilter());
    }

    [Fact]
    public void RefundReviewResponse_ExposesTheBalanceUsedForConfirmation()
    {
        var properties = typeof(AdminRefundRequestResponse).GetProperties()
            .Select(property => property.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Contains(nameof(AdminRefundRequestResponse.OriginalPaymentAmountCents), properties);
        Assert.Contains(nameof(AdminRefundRequestResponse.AlreadyRefundedAmountCents), properties);
        Assert.Contains(nameof(AdminRefundRequestResponse.RefundableAmountCents), properties);
        Assert.Contains(nameof(AdminRefundRequestResponse.ProviderPaymentIntentId), properties);
    }
}
