using DineFlow.Api.Contracts.Restaurant;
using DineFlow.Api.Services;
using Stripe;
using Xunit;

namespace DineFlow.Tests;

public sealed class StripeBusinessProfileImportBuilderTests
{
    private static TaxId CreateTaxId(string type, string value, string? verificationStatus = null) => new()
    {
        Type = type,
        Value = value,
        Verification = verificationStatus is null
            ? null
            : new TaxIdVerification { Status = verificationStatus }
    };

    [Fact]
    public void Build_MapsAvailableConnectedAccountDetailsWithoutInventingTaxOrPolicyValues()
    {
        var account = new Account
        {
            Country = "au",
            DefaultCurrency = "aud",
            Email = "account@example.com",
            BusinessProfile = new AccountBusinessProfile
            {
                Name = "Stripe Dining",
                SupportEmail = "support@example.com",
                SupportPhone = "+61 8 5555 0100"
            },
            Company = new AccountCompany
            {
                Name = "Stripe Dining Holdings Pty Ltd",
                TaxIdProvided = true,
                Address = new Address
                {
                    Line1 = "10 Test Street",
                    City = "Adelaide",
                    State = "SA",
                    PostalCode = "5000",
                    Country = "AU"
                }
            }
        };

        var result = StripeBusinessProfileImportBuilder.Build(account);
        var suggestions = result.Suggestions.ToDictionary(suggestion => suggestion.Field);

        Assert.True(result.TaxIdProvided);
        Assert.Equal(StripeBusinessTaxIdStatus.ProvidedButHidden, result.TaxIdStatus);
        Assert.Equal("Stripe Dining", suggestions["name"].Value);
        Assert.Equal("Stripe Dining Holdings Pty Ltd", suggestions["legalBusinessName"].Value);
        Assert.Equal("10 Test Street, Adelaide SA 5000", suggestions["address"].Value);
        Assert.Equal("+61 8 5555 0100", suggestions["phone"].Value);
        Assert.Equal("support@example.com", suggestions["businessContactEmail"].Value);
        Assert.Equal("support@example.com", suggestions["refundContactEmail"].Value);
        Assert.Equal("AU", suggestions["countryCode"].Value);
        Assert.Equal("AUD", suggestions["currency"].Value);
        Assert.DoesNotContain(result.Suggestions, suggestion => suggestion.Field is
            "abn" or "gstRegistered" or "pricesIncludeGst" or "customerSurchargeNotice");
    }

    [Fact]
    public void Build_WhenPublicContactDetailsAreMissing_UsesSafeAccountFallbacks()
    {
        var account = new Account
        {
            Email = "fallback@example.com",
            Individual = new Person
            {
                FirstName = "Alex",
                LastName = "Taylor",
                Phone = "+61 400 000 000"
            }
        };

        var result = StripeBusinessProfileImportBuilder.Build(account);
        var suggestions = result.Suggestions.ToDictionary(suggestion => suggestion.Field);

        Assert.Equal("Alex Taylor", suggestions["legalBusinessName"].Value);
        Assert.Equal("fallback@example.com", suggestions["businessContactEmail"].Value);
        Assert.Equal("+61 400 000 000", suggestions["phone"].Value);
        Assert.False(result.TaxIdProvided);
        Assert.Equal(StripeBusinessTaxIdStatus.Missing, result.TaxIdStatus);
    }

    [Fact]
    public void Build_WhenConnectedAccountHasAnAustralianTaxId_SuggestsTheAbnAsDigits()
    {
        var account = new Account
        {
            Country = "au",
            Company = new AccountCompany { Name = "Stripe Dining Holdings Pty Ltd", TaxIdProvided = true }
        };

        var result = StripeBusinessProfileImportBuilder.Build(
            account,
            [CreateTaxId("au_abn", "51 824 753 556")]);
        var abn = Assert.Single(result.Suggestions, suggestion => suggestion.Field == "abn");

        Assert.Equal("51824753556", abn.Value);
        Assert.Equal(StripeBusinessTaxIdStatus.Imported, result.TaxIdStatus);
        Assert.True(result.TaxIdProvided);
    }

    [Fact]
    public void Build_PrefersAVerifiedAbnAndIgnoresOtherTaxIdTypes()
    {
        var result = StripeBusinessProfileImportBuilder.Build(
            new Account { Country = "au" },
            [
                CreateTaxId("au_arn", "123456789012"),
                CreateTaxId("au_abn", "51824753556", "unverified"),
                CreateTaxId("au_abn", "53004085616", "verified")
            ]);
        var abn = Assert.Single(result.Suggestions, suggestion => suggestion.Field == "abn");

        Assert.Equal("53004085616", abn.Value);
    }

    [Fact]
    public void Build_WhenTheStoredAbnFailsItsChecksum_DoesNotSuggestIt()
    {
        var account = new Account
        {
            Country = "au",
            Company = new AccountCompany { TaxIdProvided = true }
        };

        var result = StripeBusinessProfileImportBuilder.Build(
            account,
            [CreateTaxId("au_abn", "12345678901")]);

        Assert.DoesNotContain(result.Suggestions, suggestion => suggestion.Field == "abn");
        Assert.Equal(StripeBusinessTaxIdStatus.ProvidedButHidden, result.TaxIdStatus);
    }
}
