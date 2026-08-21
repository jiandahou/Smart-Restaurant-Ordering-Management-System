using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Two writes that silently discarded each other. Stock was read, decremented in the browser and
/// written back as an absolute value, so two people serving the last portions each saw success and
/// one sale vanished. A schedule save replaces the whole calendar, so the loser of that race lost
/// every special day they had entered, with nothing to say so.
/// </summary>
public sealed class DashboardConcurrencyTests
{
    [Fact]
    public void StockIsAdjustedByTheDatabaseRatherThanRecomputedFromAReadValue()
    {
        var body = MethodBody("AdminMenuItemsController.cs", "public async Task<IActionResult> UpdateStock");

        Assert.Contains("ExecuteUpdateAsync", body, StringComparison.Ordinal);
        Assert.Contains("menuItem.StockQuantity!.Value + delta", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AnAdjustmentNeverDrivesStockBelowZero()
    {
        Assert.Contains(
            "Math.Max(0, menuItem.StockQuantity!.Value + delta)",
            MethodBody("AdminMenuItemsController.cs", "public async Task<IActionResult> UpdateStock"),
            StringComparison.Ordinal);
    }

    [Fact]
    public void SoldOutFollowsTheAdjustedCountInTheSameStatement()
    {
        // Two statements would leave a window where the count is zero and the item still orderable.
        var body = MethodBody("AdminMenuItemsController.cs", "public async Task<IActionResult> UpdateStock");
        var update = body[body.IndexOf("ExecuteUpdateAsync", StringComparison.Ordinal)..];

        Assert.Contains("menuItem.IsSoldOut", update, StringComparison.Ordinal);
    }

    [Fact]
    public void SettingAndAdjustingAreNotAcceptedTogether()
    {
        Assert.Contains(
            "Send either stockQuantity or adjustBy, not both.",
            MethodBody("AdminMenuItemsController.cs", "public async Task<IActionResult> UpdateStock"),
            StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("UpdateOpeningHours")]
    [InlineData("UpdateSpecialOpeningDays")]
    public void AScheduleSaveRefusesToOverwriteANewerVersion(string action)
    {
        var body = MethodBody("RestaurantController.cs", $"public async Task<IActionResult> {action}");

        Assert.Contains("ScheduleWasChangedElsewhere", body, StringComparison.Ordinal);
        Assert.Contains("schedule_conflict", body, StringComparison.Ordinal);
    }

    [Fact]
    public void TheConflictIsReportedAsAConflictRatherThanAFailure()
    {
        // 409 is what lets the editor offer a reload instead of saying the request failed.
        var body = MethodBody("RestaurantController.cs", "public async Task<IActionResult> UpdateSpecialOpeningDays");

        Assert.Contains("return Conflict(", body, StringComparison.Ordinal);
    }

    [Fact]
    public void AClientThatSendsNoVersionIsStillAllowedToSave()
    {
        // Older clients keep working; the check is opt-in from the caller.
        var guard = MethodBody("RestaurantController.cs", "private static bool ScheduleWasChangedElsewhere");

        Assert.Contains("is not { } expected", guard, StringComparison.Ordinal);
        Assert.Contains("return false;", guard, StringComparison.Ordinal);
    }

    private static string MethodBody(string file, string marker)
    {
        var source = File.ReadAllText(Path.Combine(
            RepositoryRoot(), "DineFlow.Api", "Controllers", file));
        var start = source.IndexOf(marker, StringComparison.Ordinal);

        Assert.True(start >= 0, $"Could not find \"{marker}\" in {file} — has it been renamed?");

        var next = source.IndexOf("\n    [Http", start, StringComparison.Ordinal);
        var privateNext = source.IndexOf("\n    private ", start + marker.Length, StringComparison.Ordinal);
        var end = next < 0 ? privateNext : privateNext < 0 ? next : Math.Min(next, privateNext);

        return end < 0 ? source[start..] : source[start..end];
    }

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
