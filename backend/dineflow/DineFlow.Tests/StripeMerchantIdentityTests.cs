using DineFlow.Api.Services;
using DineFlow.Infrastructure.Restaurant;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Whether the Stripe account a restaurant is connected to presents itself as that restaurant.
/// </summary>
/// <remarks>
/// Stripe Checkout puts the connected account's own business profile name at the top of the card
/// page — not anything DineFlow sends. An order from The DineFlow Kitchen was therefore paid on a
/// page headed <i>Central Market Table</i>, because that is what the account said it was called. The
/// accounts were not crossed and the money reached the right one; the only wrong part was the part
/// the customer could see. Nothing could catch it, because the platform read the account's
/// capabilities and never read its name.
/// </remarks>
public class StripeMerchantIdentityTests
{
    [Fact]
    public void CatchesAnAccountTradingUnderAnotherRestaurantsName()
    {
        var complaint = StripeMerchantIdentity.Describe(
            "Central Market Table", "The DineFlow Kitchen", null);

        Assert.NotNull(complaint);
        Assert.Contains("Central Market Table", complaint);
        Assert.Contains("The DineFlow Kitchen", complaint);
    }

    [Fact]
    public void AcceptsTheRestaurantsOwnName()
    {
        Assert.Null(StripeMerchantIdentity.Describe(
            "The DineFlow Kitchen", "The DineFlow Kitchen", null));
    }

    /// <summary>
    /// The legal entity is how plenty of businesses appear on a statement.
    /// </summary>
    /// <remarks>
    /// The names here are deliberately ones the trading name cannot match on its own — "Laneway
    /// Noodles" is not a substring of "Laneway Noodle Bar Pty Ltd" — so this fails if the legal name
    /// stops being consulted, rather than passing by accident on the trading name.
    /// </remarks>
    [Fact]
    public void AcceptsTheLegalNameItTradesUnder()
    {
        Assert.Null(StripeMerchantIdentity.Describe(
            "Laneway Noodle Bar Pty Ltd", "Laneway Noodles", "Laneway Noodle Bar Pty Ltd"));

        // And with no legal name recorded, the same profile name is a mismatch.
        Assert.NotNull(StripeMerchantIdentity.Describe(
            "Laneway Noodle Bar Pty Ltd", "Laneway Noodles", null));
    }

    /// <summary>
    /// Compared loosely on purpose. Punctuation and casing differ between the two systems without
    /// meaning anything, and a gate that cries wolf over an ampersand is a gate people switch off.
    /// </summary>
    [Theory]
    [InlineData("THE DINEFLOW KITCHEN")]
    [InlineData("The DineFlow Kitchen.")]
    [InlineData("the dineflow  kitchen")]
    public void IgnoresDifferencesThatMeanNothing(string profileName)
    {
        Assert.Null(StripeMerchantIdentity.Describe(profileName, "The DineFlow Kitchen", null));
    }

    /// <summary>
    /// An account that has not said who it is yet is covered by the ordinary onboarding
    /// requirements, not by this.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void SaysNothingWhenTheAccountHasNoNameYet(string? profileName)
    {
        Assert.Null(StripeMerchantIdentity.Describe(profileName, "The DineFlow Kitchen", null));
    }

    /// <summary>
    /// The restriction is raised as an error and asks for action, because until it is fixed every
    /// customer sees the wrong business — and a customer who does not recognise a charge disputes it.
    /// </summary>
    [Fact]
    public void ReportsTheMismatchAsSomethingToActOn()
    {
        var snapshot = new StripeConnectAccountStateSnapshot
        {
            BusinessProfileName = "Central Market Table"
        };

        var restrictions = StripeConnectAccountState.BuildRestrictions(
            snapshot,
            detailsSubmitted: true,
            chargesEnabled: true,
            payoutsEnabled: true,
            restaurantName: "The DineFlow Kitchen",
            legalBusinessName: null);

        var identity = Assert.Single(restrictions, item => item.Code == "merchant_identity_mismatch");
        Assert.Equal("Error", identity.Severity);
        Assert.True(identity.ActionRequired);
    }

    /// <summary>A correctly named account raises nothing, so the gate stays quiet when it should.</summary>
    [Fact]
    public void SaysNothingAboutAnAccountThatNamesTheRightRestaurant()
    {
        var snapshot = new StripeConnectAccountStateSnapshot
        {
            BusinessProfileName = "The DineFlow Kitchen"
        };

        var restrictions = StripeConnectAccountState.BuildRestrictions(
            snapshot,
            detailsSubmitted: true,
            chargesEnabled: true,
            payoutsEnabled: true,
            restaurantName: "The DineFlow Kitchen",
            legalBusinessName: null);

        Assert.DoesNotContain(restrictions, item => item.Code == "merchant_identity_mismatch");
    }
}
