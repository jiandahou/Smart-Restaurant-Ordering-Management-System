using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A full name of three spaces passed both the form and the server, creating a real unconfirmed
/// account and sending a confirmation email to it. Neither the name nor the password had any
/// maximum at all.
/// </summary>
public sealed class AccountFieldLimitsTests
{
    [Theory]
    [InlineData("   ")]
    [InlineData("\t\t")]
    [InlineData("\n")]
    [InlineData("")]
    [InlineData(null)]
    public void AWhitespaceOnlyNameIsRejected(string? value)
    {
        Assert.Equal("Full name is required.", AccountFieldLimits.DescribeFullNameProblem(value));
    }

    [Fact]
    public void ANameIsStoredWithoutItsSurroundingWhitespace()
    {
        Assert.Equal("Ada Lovelace", AccountFieldLimits.NormalizeFullName("  Ada Lovelace  "));
    }

    [Fact]
    public void TheMaximumIsMeasuredAfterTrimming()
    {
        // Otherwise padding could fail a name that is really within the limit.
        var padded = $"  {new string('a', AccountFieldLimits.FullNameMaxLength)}  ";

        Assert.Null(AccountFieldLimits.DescribeFullNameProblem(padded));
    }

    [Fact]
    public void ANameOnePastTheMaximumIsRejected()
    {
        var problem = AccountFieldLimits.DescribeFullNameProblem(
            new string('a', AccountFieldLimits.FullNameMaxLength + 1));

        Assert.NotNull(problem);
        Assert.Contains($"{AccountFieldLimits.FullNameMaxLength} characters or fewer", problem, StringComparison.Ordinal);
    }

    [Fact]
    public void AnOrdinaryNameIsAccepted()
    {
        Assert.Null(AccountFieldLimits.DescribeFullNameProblem("Ada Lovelace"));
    }

    [Fact]
    public async Task APasswordAtTheMaximumIsAccepted()
    {
        var result = await ValidatePasswordAsync(new string('a', AccountFieldLimits.PasswordMaxLength));

        Assert.True(result.Succeeded);
    }

    [Fact]
    public async Task APasswordPastTheMaximumIsRejectedRatherThanTruncated()
    {
        // Truncating would mean a shorter password could open the account.
        var result = await ValidatePasswordAsync(new string('a', AccountFieldLimits.PasswordMaxLength + 1));

        Assert.False(result.Succeeded);
        Assert.Equal("PasswordTooLong", Assert.Single(result.Errors).Code);
    }

    [Fact]
    public async Task TheFourThousandCharacterPasswordFromTheReportIsRejected()
    {
        var result = await ValidatePasswordAsync("Sunshine1!" + new string('a', 4_086));

        Assert.False(result.Succeeded);
    }

    [Fact]
    public async Task ANullPasswordIsLeftToTheOtherValidators()
    {
        // This validator has one job; "a password is required" belongs elsewhere.
        var result = await ValidatePasswordAsync(null);

        Assert.True(result.Succeeded);
    }

    private static Task<IdentityResult> ValidatePasswordAsync(string? password) =>
        new MaximumLengthPasswordValidator<ApplicationUser>().ValidateAsync(null!, new ApplicationUser(), password);
}
