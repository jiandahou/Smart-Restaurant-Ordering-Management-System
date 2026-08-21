using System.Reflection;
using DineFlow.Api.Controllers;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-013. AllergenInfoLastVerifiedAt reaches customers, so it must never claim that empty
/// allergen information was checked. The restaurant is not forced to declare anything — but what
/// is stored has to match what actually happened.
/// </summary>
public sealed class AllergenVerificationTests
{
    private static DateTime? Resolve(
        string? allergens,
        string? mayContain,
        string? crossContact,
        string? previousAllergens = null,
        string? previousMayContain = null,
        string? previousCrossContact = null,
        DateTime? previousVerifiedAt = null)
    {
        var method = typeof(AdminMenuItemsController).GetMethod(
            "ResolveAllergenVerifiedAt",
            BindingFlags.NonPublic | BindingFlags.Static);
        Assert.NotNull(method);

        return (DateTime?)method!.Invoke(null, [
            allergens, mayContain, crossContact,
            previousAllergens, previousMayContain, previousCrossContact, previousVerifiedAt,
        ]);
    }

    [Fact]
    public void NoDeclarationAtAll_LeavesTheTimestampUnset()
    {
        Assert.Null(Resolve(null, null, null));
    }

    [Fact]
    public void ClearingAPreviousDeclaration_ClearsTheTimestampToo()
    {
        // Otherwise an item stripped back to nothing keeps claiming it was verified in the past.
        var result = Resolve(
            null, null, null,
            previousAllergens: "Milk",
            previousVerifiedAt: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

        Assert.Null(result);
    }

    [Theory]
    [InlineData("Milk", null, null)]
    [InlineData(null, "Peanut", null)]
    [InlineData(null, null, "Prepared in a shared fryer.")]
    public void AnySingleDeclaredField_StampsTheTimestamp(
        string? allergens,
        string? mayContain,
        string? crossContact)
    {
        var before = DateTime.UtcNow;

        var result = Resolve(allergens, mayContain, crossContact);

        Assert.NotNull(result);
        Assert.InRange(result!.Value, before.AddSeconds(-5), DateTime.UtcNow.AddSeconds(5));
    }

    [Fact]
    public void UnchangedDeclaration_KeepsTheOriginalTimestamp()
    {
        // Editing the price must not make stale allergen information look freshly checked.
        var originallyVerifiedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var result = Resolve(
            "Milk", "Peanut", "Shared fryer.",
            previousAllergens: "Milk",
            previousMayContain: "Peanut",
            previousCrossContact: "Shared fryer.",
            previousVerifiedAt: originallyVerifiedAt);

        Assert.Equal(originallyVerifiedAt, result);
    }

    [Fact]
    public void ChangedDeclaration_MovesTheTimestampForward()
    {
        var originallyVerifiedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var result = Resolve(
            "Milk, egg", null, null,
            previousAllergens: "Milk",
            previousVerifiedAt: originallyVerifiedAt);

        Assert.NotNull(result);
        Assert.True(result > originallyVerifiedAt);
    }
}
