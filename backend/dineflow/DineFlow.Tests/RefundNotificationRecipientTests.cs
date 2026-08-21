using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-017. An automatic refund reaches a customer who never asked for one, so the address it goes
/// to matters as much as the wording. A guest checkout leaves no email on the order — the only
/// route back to the payer is the address Stripe collected on the charge.
/// </summary>
public sealed class RefundNotificationRecipientTests
{
    [Fact]
    public void SignedInCustomersAreReachedOnTheirAccountEmail()
    {
        var order = new Order { Customer = new ApplicationUser { Email = "diner@example.com" } };
        var payment = new Payment { ReceiptEmail = "card-holder@example.com" };

        Assert.Equal("diner@example.com", PaymentNotificationService.ResolveRecipient(order, payment));
    }

    [Fact]
    public void GuestsAreReachedOnTheAddressStripeCollectedAtCheckout()
    {
        // No account, so nothing on the order. PaymentSyncService copies this off the charge.
        var order = new Order();
        var payment = new Payment { ReceiptEmail = "guest@example.com" };

        Assert.Equal("guest@example.com", PaymentNotificationService.ResolveRecipient(order, payment));
    }

    [Fact]
    public void AnExplicitRequesterAddressWins()
    {
        var order = new Order { Customer = new ApplicationUser { Email = "diner@example.com" } };
        var payment = new Payment { ReceiptEmail = "guest@example.com" };

        Assert.Equal(
            "asked-from-here@example.com",
            PaymentNotificationService.ResolveRecipient(order, payment, "asked-from-here@example.com"));
    }

    [Fact]
    public void NoAddressAnywhereMeansNoRecipientRatherThanAGuess()
    {
        Assert.Null(PaymentNotificationService.ResolveRecipient(new Order(), new Payment()));
    }

    [Theory]
    [InlineData("  spaced@example.com  ", "spaced@example.com")]
    [InlineData("   ", null)]
    public void AddressesAreTrimmedAndBlanksIgnored(string stored, string? expected)
    {
        var payment = new Payment { ReceiptEmail = stored };

        Assert.Equal(expected, PaymentNotificationService.ResolveRecipient(new Order(), payment));
    }
}
