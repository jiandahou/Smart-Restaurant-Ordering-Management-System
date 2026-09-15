using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// FS-012. An ABN reaches customers on receipts and tax invoices, so a fabricated one has to be
/// rejected where it is entered rather than discovered later.
/// </summary>
public sealed class AustralianBusinessNumberTests
{
    [Theory]
    // Published ATO worked example, plus a real listed-company ABN.
    [InlineData("51824753556")]
    [InlineData("53004085616")]
    [InlineData("51 824 753 556")]
    [InlineData("51-824-753-556")]
    public void IsValid_AcceptsWellFormedNumbersRegardlessOfSpacing(string value)
    {
        Assert.True(AustralianBusinessNumber.IsValid(value));
    }

    [Fact]
    public void IsValid_RejectsTheElevenDigitPlaceholderThatReachedProduction()
    {
        // The exact value FS-012 found on a live restaurant record. Eleven digits, wrong checksum.
        Assert.True(AustralianBusinessNumber.HasValidLength("12345678901"));
        Assert.False(AustralianBusinessNumber.IsValid("12345678901"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("5182475355")]     // ten digits
    [InlineData("518247535561")]   // twelve digits
    [InlineData("5182475355A")]
    [InlineData("00000000000")]
    public void IsValid_RejectsAnythingThatIsNotElevenCheckedDigits(string? value)
    {
        Assert.False(AustralianBusinessNumber.IsValid(value));
    }

    [Fact]
    public void IsValid_RejectsATransposedPairThatWouldOtherwisePassALengthCheck()
    {
        // Swapping two digits of a valid ABN is the realistic typing mistake the checksum exists
        // to catch.
        Assert.True(AustralianBusinessNumber.IsValid("51824753556"));
        Assert.False(AustralianBusinessNumber.IsValid("51824753565"));
    }

    [Fact]
    public void Normalize_KeepsDigitsOnlySoFormattingCannotCreateDuplicates()
    {
        Assert.Equal("51824753556", AustralianBusinessNumber.Normalize(" 51 824 753 556 "));
        Assert.Null(AustralianBusinessNumber.Normalize("   "));
        Assert.Null(AustralianBusinessNumber.Normalize(null));
    }

    [Fact]
    public void Format_GroupsTheDigitsAsTheRegisterPrintsThem()
    {
        Assert.Equal("51 824 753 556", AustralianBusinessNumber.Format("51824753556"));
    }
}
