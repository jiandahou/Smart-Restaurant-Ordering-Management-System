using System.Text.RegularExpressions;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Every transactional email goes through <c>TransactionalEmailLayout</c>. This is enforced against
/// the source rather than at runtime because the failure mode is a new email being written the old
/// way — hand-rolled paragraph tags that arrive with no sender identity, look nothing like the rest
/// of our mail, and give a recipient no way to tell them from a phishing attempt. Nothing at
/// runtime would ever notice.
/// </summary>
public sealed class TransactionalEmailConsistencyTests
{
    /// <summary>The one file allowed to contain email markup: it is the layout.</summary>
    private const string LayoutFileName = "TransactionalEmailLayout.cs";

    [Fact]
    public void NoEmailBodyIsBuiltByHand()
    {
        var offenders = ApiSourceFiles()
            .Where(file => Path.GetFileName(file) != LayoutFileName)
            .Select(file => (File: Path.GetFileName(file), Markup: FindEmailMarkup(File.ReadAllText(file))))
            .Where(found => found.Markup.Count > 0)
            .Select(found => $"{found.File}: {string.Join(", ", found.Markup)}")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            "These build email HTML directly instead of using TransactionalEmailLayout:"
                + Environment.NewLine
                + string.Join(Environment.NewLine, offenders));
    }

    private static IReadOnlyList<string> FindEmailMarkup(string source) =>
        Regex.Matches(source, @"<(p|div|table|h1|strong)[ >]")
            .Select(match => match.Value.TrimEnd(' ', '>'))
            .Distinct()
            .ToList();

    private static IEnumerable<string> ApiSourceFiles() =>
        Directory.EnumerateFiles(Path.Combine(RepositoryRoot(), "DineFlow.Api"), "*.cs", SearchOption.AllDirectories)
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .Where(file => !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"));

    /// <summary>Walks up from the test binary to the folder holding the solution.</summary>
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
