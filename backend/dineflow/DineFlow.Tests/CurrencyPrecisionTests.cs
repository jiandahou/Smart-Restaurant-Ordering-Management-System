using DineFlow.Api.Services;
using DineFlow.Infrastructure.Menu;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A price of A$9.999 was accepted and stored exactly. Nothing downstream could carry it, and each
/// stage disagreed about what it meant: the order line column rounded it to 10.00, the order total
/// column kept 29.997 for three of them, and Stripe was sent 1000 minor units each. The customer
/// paid A$30.00 against a record of A$29.997.
/// </summary>
public sealed class CurrencyPrecisionTests
{
    [Theory]
    [InlineData(9.999)]
    [InlineData(0.001)]
    [InlineData(10.005)]
    [InlineData(1.234567)]
    public void APriceFinerThanACentIsRefused(decimal price)
    {
        Assert.NotNull(CurrencyPrecision.DescribeProblem(price, "AUD", "Price"));
    }

    [Theory]
    [InlineData(9.99)]
    [InlineData(10)]
    [InlineData(0.01)]
    [InlineData(1000000)]
    public void APriceInWholeCentsIsAccepted(decimal price)
    {
        Assert.Null(CurrencyPrecision.DescribeProblem(price, "AUD", "Price"));
    }

    [Fact]
    public void TrailingZeroesAreNotExtraPrecision()
    {
        // 9.9900m carries a scale of four in .NET while being exactly nine dollars ninety-nine.
        Assert.Null(CurrencyPrecision.DescribeProblem(9.9900m, "AUD", "Price"));
    }

    [Fact]
    public void ANegativeAdjustmentIsHeldToTheSameRule()
    {
        // "Remove" options carry a negative adjustment, and a discount of -1.005 is as unpayable as
        // a price of 1.005.
        Assert.NotNull(CurrencyPrecision.DescribeProblem(-1.005m, "AUD", "Price adjustment"));
        Assert.Null(CurrencyPrecision.DescribeProblem(-1.50m, "AUD", "Price adjustment"));
    }

    [Fact]
    public void TheMessageNamesTheFieldAndTheCurrency()
    {
        var problem = CurrencyPrecision.DescribeProblem(9.999m, "AUD", "Price");

        Assert.Contains("Price", problem);
        Assert.Contains("AUD", problem);
    }

    /// <summary>
    /// The number of decimals is a fact about the currency, not about AUD. Recorded so that the
    /// rule below — which currencies are refused outright — is checked against real minor units.
    /// </summary>
    [Theory]
    [InlineData("AUD", 2)]
    [InlineData("NPR", 2)]
    [InlineData("INR", 2)]
    [InlineData("JPY", 0)]
    [InlineData("KRW", 0)]
    [InlineData("KWD", 3)]
    [InlineData("BHD", 3)]
    public void EachCurrencyKnowsItsOwnMinorUnit(string currency, int expected)
    {
        Assert.Equal(expected, CurrencyPrecision.DecimalPlaces(currency));
    }

    /// <summary>
    /// The money path multiplies by exactly 100 everywhere, so a yen price would be sent to Stripe
    /// at a hundred times its value. Refusing the price says so instead of charging it.
    /// </summary>
    [Theory]
    [InlineData("JPY")]
    [InlineData("KWD")]
    public void ACurrencyTheMoneyPathCannotRepresentIsRefusedOutright(string currency)
    {
        var problem = CurrencyPrecision.DescribeProblem(1000m, currency, "Price");

        Assert.NotNull(problem);
        Assert.Contains(currency, problem);
    }

    /// <summary>
    /// The rule above is only correct while every conversion assumes hundredths. If that constant
    /// ever becomes currency-aware, this test is the reminder that the refusal can be lifted.
    /// </summary>
    [Fact]
    public void TheHundredthsAssumptionThisRuleRestsOnStillHolds()
    {
        Assert.Equal(1000, PricingCalculator.ToMinorCurrencyUnits(10m));
        Assert.Equal(999, PricingCalculator.ToMinorCurrencyUnits(9.99m));
    }

    /// <summary>
    /// The rule is worth nothing where prices are actually written. Both menu item prices and
    /// option adjustments reach the same money columns, so both have to be checked.
    /// </summary>
    [Theory]
    [InlineData("AdminMenuItemsController.cs", 2)]
    [InlineData("MenuOptionGroupController.cs", 2)]
    public void EveryPriceWritePathChecksThePrecision(string controller, int expectedCallSites)
    {
        var source = File.ReadAllText(ControllerPath(controller));
        var callSites = source.Split("DescribePriceProblemAsync(").Length - 1;

        // One declaration plus one call per write path.
        Assert.True(
            callSites >= expectedCallSites + 1,
            $"{controller} checks price precision in {callSites - 1} place(s); create and update both need it.");
    }

    /// <summary>
    /// The reported symptom, end to end: what the database keeps and what Stripe is asked to charge
    /// have to be the same number.
    /// </summary>
    [Fact]
    public void AnAcceptedPriceReachesStripeWithoutRounding()
    {
        const decimal price = 9.99m;

        Assert.Null(CurrencyPrecision.DescribeProblem(price, "AUD", "Price"));

        var total = PricingCalculator.CalculateTotal([(3, price)]);

        Assert.Equal(29.97m, total);
        Assert.Equal(2997, PricingCalculator.ToMinorCurrencyUnits(total));
        Assert.Equal(3 * PricingCalculator.ToMinorCurrencyUnits(price), PricingCalculator.ToMinorCurrencyUnits(total));
    }

    private static string ControllerPath(string fileName)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", fileName);
    }
}
