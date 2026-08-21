using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Search patterns were built as <c>$"%{search}%"</c>, which handed the caller LIKE's wildcards.
/// Searching the user directory for a single underscore produced <c>%_%</c> — any string of at
/// least one character — and returned all 24 accounts instead of the ones containing one.
/// </summary>
public sealed class SearchPatternTests
{
    [Fact]
    public void AnUnderscoreMatchesAnUnderscoreRatherThanAnyCharacter()
    {
        Assert.Equal(@"%\_%", SearchPattern.Contains("_"));
    }

    [Fact]
    public void APercentMatchesAPercentRatherThanEverything()
    {
        Assert.Equal(@"%\%%", SearchPattern.Contains("%"));
    }

    [Fact]
    public void TheEscapeCharacterItselfIsEscapedFirst()
    {
        // Escaping % before \ would turn "\" into "\\%" and change what the pattern means.
        Assert.Equal(@"%\\%", SearchPattern.Contains(@"\"));
        Assert.Equal(@"%\\\%%", SearchPattern.Contains(@"\%"));
    }

    [Theory]
    [InlineData("ada", "%ada%")]
    [InlineData("Ada Lovelace", "%Ada Lovelace%")]
    [InlineData("diner@example.com", "%diner@example.com%")]
    [InlineData("", "%%")]
    public void OrdinaryTextIsLeftAlone(string input, string expected)
    {
        Assert.Equal(expected, SearchPattern.Contains(input));
    }

    [Fact]
    public void AMixedStringEscapesEveryWildcard()
    {
        Assert.Equal(@"%a\_b\%c%", SearchPattern.Contains("a_b%c"));
    }

    [Fact]
    public void EveryUserSuppliedPatternIsBuiltThroughThisHelper()
    {
        // The bug was one line repeated in nine files; a tenth copy would reintroduce it silently.
        var offenders = SourceFiles()
            .Where(file => File.ReadAllText(file).Contains("$\"%{", StringComparison.Ordinal))
            .Select(Path.GetFileName)
            .Where(name => name != "SearchPattern.cs")
            .ToList();

        Assert.True(offenders.Count == 0, "These build a search pattern by hand: " + string.Join(", ", offenders));
    }

    [Fact]
    public void EveryPatternedILikePassesTheEscapeCharacter()
    {
        // A pattern that escapes wildcards is useless unless the query says what the escape is.
        var offenders = new List<string>();

        foreach (var file in SourceFiles())
        {
            foreach (var line in File.ReadAllLines(file))
            {
                if (!line.Contains("EF.Functions.ILike", StringComparison.Ordinal)) continue;
                // Literal patterns written by us are meant to use wildcards and stay unescaped.
                if (line.Contains("\"%", StringComparison.Ordinal)) continue;
                if (line.Contains("EscapeCharacter", StringComparison.Ordinal)) continue;

                offenders.Add($"{Path.GetFileName(file)}: {line.Trim()}");
            }
        }

        Assert.True(offenders.Count == 0, string.Join("\n", offenders));
    }

    private static IEnumerable<string> SourceFiles() =>
        Directory.EnumerateFiles(Path.Combine(RepositoryRoot(), "DineFlow.Api"), "*.cs", SearchOption.AllDirectories)
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
