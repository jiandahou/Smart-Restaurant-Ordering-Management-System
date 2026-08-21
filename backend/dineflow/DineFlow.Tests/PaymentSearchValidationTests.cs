using System.ComponentModel.DataAnnotations;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Contracts.Payments;
using Xunit;

namespace DineFlow.Tests;

public sealed class PaymentSearchValidationTests
{
    public static TheoryData<object> PaymentSearchRequests() => new()
    {
        new AdminOrderListRequest(),
        new AdminRefundListRequest(),
        new AdminRefundRequestListRequest(),
        new AdminRefundSummaryRequest()
    };

    [Theory]
    [MemberData(nameof(PaymentSearchRequests))]
    public void PaymentViewsAcceptTwoHundredSearchCharacters(object request)
    {
        SetSearch(request, new string('a', 200));

        Assert.Empty(Validate(request));
    }

    [Theory]
    [MemberData(nameof(PaymentSearchRequests))]
    public void PaymentViewsRejectTwoHundredAndOneSearchCharacters(object request)
    {
        SetSearch(request, new string('a', 201));

        Assert.Contains(Validate(request), result => result.MemberNames.Contains("Search"));
    }

    private static void SetSearch(object request, string search) =>
        request.GetType().GetProperty("Search")!.SetValue(request, search);

    private static List<ValidationResult> Validate(object request)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(request, new ValidationContext(request), results, validateAllProperties: true);
        return results;
    }
}
