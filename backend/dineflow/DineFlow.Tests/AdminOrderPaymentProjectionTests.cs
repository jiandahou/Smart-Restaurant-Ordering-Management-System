using System.Reflection;
using System.Text.Json;
using DineFlow.Api.Contracts.Order;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

public sealed class AdminOrderPaymentProjectionTests
{
    [Fact]
    public void LatestPaymentCarriesItsConnectedStripeAccountIntoTheApiResponse()
    {
        var connectedAccountId = "acct_connected_restaurant";
        var order = new Order
        {
            Payments =
            [
                new Payment
                {
                    CreatedAt = new DateTime(2026, 8, 10, 1, 0, 0, DateTimeKind.Utc),
                    StripeAccountId = "acct_older_payment"
                },
                new Payment
                {
                    CreatedAt = new DateTime(2026, 8, 11, 1, 0, 0, DateTimeKind.Utc),
                    ProviderPaymentIntentId = "pi_connected_payment",
                    StripeAccountId = connectedAccountId
                }
            ]
        };

        var response = MapToAdminResponse(order);

        Assert.NotNull(response.LatestPayment);
        Assert.Equal(connectedAccountId, response.LatestPayment.StripeAccountId);

        // This also guards the public JSON contract consumed by the admin UI.
        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains($"\"stripeAccountId\":\"{connectedAccountId}\"", json, StringComparison.Ordinal);
    }

    private static AdminOrderResponse MapToAdminResponse(Order order)
    {
        var mapper = typeof(AdminOrdersController).GetMethod(
            "MapToAdminResponse",
            BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(mapper);
        return Assert.IsType<AdminOrderResponse>(mapper.Invoke(null, [order]));
    }
}
