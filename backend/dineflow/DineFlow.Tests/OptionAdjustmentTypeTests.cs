using DineFlow.Infrastructure.Menu;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The adjustment type is persisted as a plain integer and the API cast the request straight to the
/// enum, so a request naming type 99 was accepted and stored. What it meant then depended on who
/// was reading it: the customer's browser had no case for it and fell through to its "add" branch,
/// showing +A$1.00 on a A$12.34 plate, while this calculator's switch had a default that left the
/// price untouched and charged A$12.34.
///
/// <para>
/// The default looked like a safe fallback and was the opposite of one. Ignoring a pricing rule you
/// do not recognise means charging a price nobody agreed to, and doing it silently means nobody
/// finds out.
/// </para>
/// </summary>
public sealed class OptionAdjustmentTypeTests
{
    private const decimal PlatePrice = 12.34m;

    [Fact]
    public void AnUnknownAdjustmentTypeIsRefusedRatherThanIgnored()
    {
        var unknown = new MenuOptionPriceSelection((OptionAdjustmentType)99, 1m, 1);

        var error = Assert.Throws<ArgumentOutOfRangeException>(
            () => PricingCalculator.CalculateUnitPrice(PlatePrice, [unknown]));

        Assert.Contains("no pricing rule", error.Message);
    }

    [Fact]
    public void AnUnknownTypeDoesNotQuietlyChargeThePlatePrice()
    {
        // The exact behaviour that made the divergence invisible: the line priced as if the option
        // had not been chosen, and the response looked entirely successful.
        var unknown = new MenuOptionPriceSelection((OptionAdjustmentType)99, 1m, 1);

        Assert.ThrowsAny<Exception>(() => PricingCalculator.CalculateUnitPrice(PlatePrice, [unknown]));
    }

    [Theory]
    [InlineData(OptionAdjustmentType.Add, 1, 2, 14.34)]
    [InlineData(OptionAdjustmentType.Remove, -2, 1, 10.34)]
    [InlineData(OptionAdjustmentType.Replace, 20, 1, 20)]
    public void EachKnownTypeKeepsItsOwnRule(
        OptionAdjustmentType type,
        decimal adjustment,
        int quantity,
        decimal expected)
    {
        var selection = new MenuOptionPriceSelection(type, adjustment, quantity);

        Assert.Equal(expected, PricingCalculator.CalculateUnitPrice(PlatePrice, [selection]));
    }

    /// <summary>
    /// The frontend implements the same three rules in <c>src/lib/menuOptionPricing.ts</c>. These
    /// are the figures both sides have to produce; if one of them ever changes, the pair of test
    /// suites disagreeing is the signal.
    /// </summary>
    [Fact]
    public void TheChargedPriceMatchesTheFiguresTheMenuDisplays()
    {
        Assert.Equal(
            14.34m,
            PricingCalculator.CalculateUnitPrice(PlatePrice, [new(OptionAdjustmentType.Add, 1m, 2)]));
        Assert.Equal(
            10.34m,
            PricingCalculator.CalculateUnitPrice(PlatePrice, [new(OptionAdjustmentType.Remove, -2m, 1)]));
        Assert.Equal(
            20m,
            PricingCalculator.CalculateUnitPrice(PlatePrice, [new(OptionAdjustmentType.Replace, 20m, 1)]));
    }

    [Fact]
    public void OnlyThreeTypesExist()
    {
        // The database check constraint and both apps hard-code 0, 1 and 2. A fourth member added
        // without touching them would be stored and then priced by nobody.
        Assert.Equal(
            [OptionAdjustmentType.Add, OptionAdjustmentType.Remove, OptionAdjustmentType.Replace],
            Enum.GetValues<OptionAdjustmentType>());
    }

    /// <summary>Both option write paths check the value before casting it.</summary>
    [Fact]
    public void TheApiRefusesAnUndefinedTypeOnEveryWritePath()
    {
        var source = File.ReadAllText(ControllerPath("MenuOptionGroupController.cs"));

        var guards = source.Split("Enum.IsDefined(typeof(OptionAdjustmentType)").Length - 1;
        var casts = source.Split("(OptionAdjustmentType)request.AdjustmentType").Length - 1;

        Assert.True(
            guards >= casts,
            $"{casts} place(s) cast a request straight to the enum but only {guards} check it first.");
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
