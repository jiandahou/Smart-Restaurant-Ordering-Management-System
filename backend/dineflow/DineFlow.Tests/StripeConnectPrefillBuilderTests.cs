using DineFlow.Api.Services;
using DineFlow.Infrastructure.Restaurant;
using Xunit;

namespace DineFlow.Tests;

public class StripeConnectPrefillBuilderTests
{
    [Fact]
    public void Build_PrefillsCustomerFacingRestaurantDetails()
    {
        var restaurant = new Restaurant
        {
            Name = "Central Market Table",
            Address = "44 Gouger Street, Adelaide SA 5000",
            Phone = "+61 8 7000 1007",
            CountryCode = "AU",
            Currency = "AUD"
        };

        var profile = StripeConnectPrefillBuilder.Build(
            restaurant,
            "owner@example.com");

        Assert.Equal("Central Market Table", profile.Name);
        Assert.Equal(
            "Central Market Table provides restaurant dining, takeaway, and online ordering services.",
            profile.ProductDescription);
        Assert.Equal("owner@example.com", profile.SupportEmail);
        Assert.Equal("+61 8 7000 1007", profile.SupportPhone);
        Assert.NotNull(profile.SupportAddress);
        Assert.Equal("44 Gouger Street", profile.SupportAddress.Line1);
        Assert.Equal("Adelaide", profile.SupportAddress.City);
        Assert.Equal("SA", profile.SupportAddress.State);
        Assert.Equal("5000", profile.SupportAddress.PostalCode);
        Assert.Equal("AU", profile.SupportAddress.Country);
    }

    [Fact]
    public void BuildSupportAddress_LeavesUnstructuredInternationalAddressIntact()
    {
        var restaurant = new Restaurant
        {
            Name = "Spice Garden",
            Address = "88 MG Road, Bengaluru, Karnataka 560001",
            CountryCode = "IN",
            Currency = "INR"
        };

        var address = StripeConnectPrefillBuilder.BuildSupportAddress(restaurant);

        Assert.NotNull(address);
        Assert.Equal("88 MG Road, Bengaluru, Karnataka 560001", address.Line1);
        Assert.Equal("IN", address.Country);
        Assert.Null(address.City);
        Assert.Null(address.State);
        Assert.Null(address.PostalCode);
    }

    [Fact]
    public void Build_DoesNotInventMissingSupportDetails()
    {
        var restaurant = new Restaurant
        {
            Name = "Quiet Cafe",
            Address = " ",
            Phone = " ",
            CountryCode = "AU",
            Currency = "AUD"
        };

        var profile = StripeConnectPrefillBuilder.Build(restaurant, null);

        Assert.Null(profile.SupportEmail);
        Assert.Null(profile.SupportPhone);
        Assert.Null(profile.SupportAddress);
    }
}
