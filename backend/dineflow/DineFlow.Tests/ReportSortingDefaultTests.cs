using System.Reflection;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Reporting;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The audit, order-event and payment-event report tabs each pick a sort column from an allow-list,
/// and each is supposed to fall back to CreatedAt when the caller names none.
///
/// <para>
/// The fallback was written as <c>IsNullOrWhiteSpace(sortBy) ? "createdAt" : sortBy.Trim().ToLowerInvariant()</c>
/// — the lower-casing applied only to the caller's value, never to the default. An ordinal string
/// switch does not match "createdAt" against its "createdat" branch, so omitting sortBy fell through
/// to null and the endpoint answered 400 "Unsupported sortBy value" naming a value the caller had
/// not sent. The Activity tab, which sorts elsewhere, answered 200 for the same request, so the
/// four tabs disagreed about whether sortBy was optional.
/// </para>
/// </summary>
public sealed class ReportSortingDefaultTests
{
    public static TheoryData<string> OmittedSortValues() => new() { null!, "", "   ", "\t" };

    [Theory]
    [MemberData(nameof(OmittedSortValues))]
    public void AuditSorting_FallsBackToCreatedAt_WhenSortByIsOmitted(string? sortBy)
        => AssertSorts<AuditLog>("ApplyAuditSorting", sortBy);

    [Theory]
    [MemberData(nameof(OmittedSortValues))]
    public void OrderEventSorting_FallsBackToCreatedAt_WhenSortByIsOmitted(string? sortBy)
        => AssertSorts<OrderEventLog>("ApplyOrderEventSorting", sortBy);

    [Theory]
    [MemberData(nameof(OmittedSortValues))]
    public void PaymentEventSorting_FallsBackToCreatedAt_WhenSortByIsOmitted(string? sortBy)
        => AssertSorts<PaymentEventLog>("ApplyPaymentEventSorting", sortBy);

    /// The caller's own spelling still decides the column, whatever case they send it in.
    [Theory]
    [InlineData("createdAt")]
    [InlineData("CREATEDAT")]
    [InlineData("  createdat  ")]
    [InlineData("action")]
    public void AuditSorting_AcceptsAllowedValues_RegardlessOfCase(string sortBy)
        => AssertSorts<AuditLog>("ApplyAuditSorting", sortBy);

    /// The allow-list is what keeps an arbitrary string out of the ORDER BY, so it has to stay shut.
    [Theory]
    [InlineData("password")]
    [InlineData("id; DROP TABLE \"AuditLogs\"")]
    [InlineData("createdAtt")]
    public void AuditSorting_StillRefusesValuesOutsideTheAllowList(string sortBy)
        => Assert.Null(Invoke<AuditLog>("ApplyAuditSorting", sortBy));

    private static void AssertSorts<T>(string methodName, string? sortBy) where T : class
        => Assert.NotNull(Invoke<T>(methodName, sortBy));

    private static object? Invoke<T>(string methodName, string? sortBy) where T : class
    {
        var method = typeof(AdminReportsController)
            .GetMethod(methodName, BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        return method!.Invoke(null, [Array.Empty<T>().AsQueryable(), sortBy, true]);
    }
}
