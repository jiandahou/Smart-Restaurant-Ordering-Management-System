using System.Text.RegularExpressions;
using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-012. Demo restaurants are where testers get their sample data; when the seed left every
/// compliance field blank, someone typed 12345678901 and 2@gmail.com into a live record instead.
/// The seed now carries realistic identities — and keeps a few deliberately incomplete, because
/// the "not provided" rendering paths have to stay testable too.
/// </summary>
public sealed class SeedRestaurantIdentityTests
{
    private static string ReadSeeder()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        var path = Path.Combine(
            directory!.FullName, "DineFlow.Infrastructure", "Identity", "IdentitySeeder.cs");
        Assert.True(File.Exists(path), $"Seeder not found at {path}.");

        return File.ReadAllText(path);
    }

    private static IReadOnlyList<string> SeededAbns() =>
        Regex.Matches(ReadSeeder(), @"Abn:\s*""(?<abn>\d+)""")
            .Select(match => match.Groups["abn"].Value)
            .ToList();

    [Fact]
    public void EverySeededAbnPassesTheSameValidationAsAUserEnteredOne()
    {
        var abns = SeededAbns();

        Assert.NotEmpty(abns);
        foreach (var abn in abns)
        {
            Assert.True(
                AustralianBusinessNumber.IsValid(abn),
                $"Seeded ABN {abn} would be rejected by the restaurant form.");
        }
    }

    [Fact]
    public void SeededAbnsAreDistinct()
    {
        var abns = SeededAbns();

        Assert.Equal(abns.Count, abns.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void NoSeededAbnIsAnObviousPlaceholder()
    {
        var placeholders = new[] { "12345678901", "11111111111", "00000000000", "99999999999" };

        Assert.Empty(SeededAbns().Intersect(placeholders, StringComparer.Ordinal));
    }

    [Fact]
    public void SomeRestaurantsAreLeftWithoutAnIdentityOnPurpose()
    {
        // Without these, the "ABN not provided" and "no refund contact" paths would never be seen
        // in a development database, which is how the gap went unnoticed the first time.
        var seeder = ReadSeeder();
        var seedCount = Regex.Matches(seeder, @"new SeedRestaurant\(").Count;

        Assert.True(seedCount > SeededAbns().Count,
            "Every seeded restaurant has an ABN; leave at least one without so the missing-identity paths stay testable.");
    }

    [Fact]
    public void AtLeastOneSeededRestaurantIsNotGstRegistered()
    {
        // Its receipts must print as RECEIPT rather than TAX INVOICE — the branch needs data.
        Assert.Contains("GstRegistered: false", ReadSeeder(), StringComparison.Ordinal);
    }
}
