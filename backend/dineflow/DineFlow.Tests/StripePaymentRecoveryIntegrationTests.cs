using System.Net.Http;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using Xunit;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;
using PaymentMethod = DineFlow.Infrastructure.Payments.PaymentMethod;

namespace DineFlow.Tests;

public sealed class StripePaymentRecoveryIntegrationTests
{
    [Fact]
    public async Task PartialRefundTimeoutRetry_RecoveredSuccessDoesNotCreateSecondRefund()
    {
        await using var context = CreateContext();
        var order = new Order
        {
            OrderNumber = "RECOVERY-REFUND",
            PaymentMethod = PaymentMethod.Online,
            PaymentStatus = PaymentStatus.Paid,
            TotalAmount = 100m
        };
        var payment = new Payment
        {
            Order = order,
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            ProviderPaymentIntentId = "pi_recovery",
            StripeAccountId = "acct_recovery",
            AmountCents = 10_000,
            Currency = "aud",
            Status = PaymentStatus.Paid
        };
        var pendingRefund = new PaymentRefund
        {
            Payment = payment,
            PaymentId = payment.Id,
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            ProviderPaymentIntentId = payment.ProviderPaymentIntentId,
            AmountCents = 2_000,
            Currency = "aud",
            Status = PaymentRefundStatus.Pending
        };
        var refundRequest = new PaymentRefundRequest
        {
            Order = order,
            OrderId = order.Id,
            Payment = payment,
            PaymentId = payment.Id,
            RequestedAmountCents = 2_000,
            Currency = "aud",
            Status = PaymentRefundRequestStatus.Processing
        };
        order.Payments.Add(payment);
        order.RefundRequests.Add(refundRequest);
        payment.Refunds.Add(pendingRefund);
        payment.RefundRequests.Add(refundRequest);
        context.Add(order);
        await context.SaveChangesAsync();

        var recoveredStripeRefund = new Refund
        {
            Id = "re_recovered",
            PaymentIntentId = payment.ProviderPaymentIntentId,
            Amount = pendingRefund.AmountCents,
            Currency = "aud",
            Status = "succeeded",
            Metadata = new Dictionary<string, string>
            {
                ["refundId"] = pendingRefund.Id.ToString()
            }
        };
        var stripeClient = new RecordingStripeClient((method, path) =>
        {
            Assert.Equal(HttpMethod.Get, method);
            Assert.Equal("/v1/refunds", path);
            return new StripeList<Refund> { Data = [recoveredStripeRefund] };
        });
        var processor = new OrderRefundProcessor(
            context,
            stripeClient,
            Options.Create(new StripeOptions { SecretKey = "sk_test_recovery" }),
            TestServiceStubs.CreateOrderRealtimeNotifier(),
            TestServiceStubs.CreatePaymentNotificationService(),
            TestServiceStubs.CreateReportLogWriter(context),
            NullLogger<OrderRefundProcessor>.Instance);

        var result = await processor.RefundAsync(
            order,
            "admin-user",
            "Partial refund",
            "refund-request-approval",
            CancellationToken.None,
            $"refund-request-{refundRequest.Id:N}",
            2_000,
            refundRequest.Id);

        Assert.True(result.IsSuccess);
        Assert.Same(pendingRefund, result.Refund);
        Assert.Equal(1, stripeClient.RequestCount);
        Assert.Equal("re_recovered", pendingRefund.ProviderRefundId);
        Assert.Equal(PaymentRefundStatus.Succeeded, pendingRefund.Status);
        Assert.Equal(PaymentStatus.PartiallyRefunded, payment.Status);
        Assert.Equal(PaymentStatus.PartiallyRefunded, order.PaymentStatus);
        Assert.Equal(PaymentRefundRequestStatus.Approved, refundRequest.Status);
        Assert.Equal(pendingRefund.Id, refundRequest.PaymentRefundId);
        Assert.Single(payment.Refunds);
    }

    [Fact]
    public async Task CheckoutSessionLookupTimeout_PreservesOriginalSessionAndDoesNotCreateAnother()
    {
        await using var context = CreateContext();
        var restaurant = new RestaurantEntity
        {
            Name = "Recovery Restaurant",
            Address = "1 Test Street",
            Phone = "0000",
            Currency = "aud",
            StripeAccountId = "acct_checkout",
            StripeChargesEnabled = true
        };
        var order = new Order
        {
            Restaurant = restaurant,
            RestaurantId = restaurant.Id,
            OrderNumber = "RECOVERY-CHECKOUT",
            PaymentMethod = PaymentMethod.Online,
            PaymentStatus = PaymentStatus.Pending,
            TotalAmount = 25m
        };
        order.OrderItems.Add(new OrderItem
        {
            Order = order,
            OrderId = order.Id,
            MenuItemNameSnapshot = "Meal",
            Quantity = 1,
            UnitPrice = 25m,
            BasePriceSnapshot = 25m
        });
        var payment = new Payment
        {
            Order = order,
            OrderId = order.Id,
            Provider = PaymentProviders.Stripe,
            ProviderCheckoutSessionId = "cs_original",
            CheckoutUrl = "https://checkout.stripe.test/original",
            IdempotencyKey = "order-checkout-original",
            StripeAccountId = restaurant.StripeAccountId,
            AmountCents = 2_500,
            Currency = "aud",
            Status = PaymentStatus.Pending
        };
        order.Payments.Add(payment);
        context.Add(order);
        await context.SaveChangesAsync();

        var stripeClient = new RecordingStripeClient((_, _) => throw new StripeException("temporary timeout"));
        var service = new StripeOrderCheckoutService(
            context,
            stripeClient,
            Options.Create(new StripeOptions
            {
                SecretKey = "sk_test_checkout",
                SuccessUrl = "http://localhost/payment/success",
                CancelUrl = "http://localhost/payment/cancelled"
            }),
            TestServiceStubs.CreateOrderRealtimeNotifier(),
            TestServiceStubs.CreateReportLogWriter(context),
            NullLogger<StripeOrderCheckoutService>.Instance);

        var result = await service.StartAsync(order.Id, null, null, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(502, result.StatusCode);
        Assert.Equal(1, stripeClient.RequestCount);
        Assert.Equal("cs_original", payment.ProviderCheckoutSessionId);
        Assert.Equal("https://checkout.stripe.test/original", payment.CheckoutUrl);
        Assert.Equal("order-checkout-original", payment.IdempotencyKey);
        Assert.Single(order.Payments);
    }

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"stripe-recovery-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options);

    private sealed class RecordingStripeClient(
        Func<HttpMethod, string, object> responseFactory) : IStripeClient
    {
        public int RequestCount { get; private set; }

        public string ApiBase => "https://api.stripe.test";
        public string ApiKey => "sk_test";
        public string ClientId => "client_test";
        public string ConnectBase => "https://connect.stripe.test";
        public string FilesBase => "https://files.stripe.test";
        public string MeterEventsBase => "https://meter-events.stripe.test";

        public Task<T> RequestAsync<T>(
            HttpMethod method,
            string path,
            BaseOptions options,
            RequestOptions requestOptions,
            CancellationToken cancellationToken = default)
            where T : IStripeEntity
        {
            RequestCount++;
            return Task.FromResult((T)responseFactory(method, path));
        }

        public Task<Stream> RequestStreamingAsync(
            HttpMethod method,
            string path,
            BaseOptions options,
            RequestOptions requestOptions,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
