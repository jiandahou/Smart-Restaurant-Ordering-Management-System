using Xunit;

namespace DineFlow.Tests;

public sealed class StaffOrderTransitionConcurrencyTests
{
    [Fact]
    public void TransitionClaimsTheStatusItLoadedInOneDatabaseStatement()
    {
        var body = TransitionBody();

        Assert.Contains("item.Status == previousStatus", body, StringComparison.Ordinal);
        Assert.Contains("ExecuteUpdateAsync", body, StringComparison.Ordinal);
        Assert.Contains("if (claimed == 0)", body, StringComparison.Ordinal);
        Assert.Contains("return Conflict(", body, StringComparison.Ordinal);
    }

    [Fact]
    public void StaleClientStatusIsRejectedBeforeApplyingTheAction()
    {
        var body = TransitionBody();

        Assert.Contains("request.ExpectedStatus", body, StringComparison.Ordinal);
        Assert.Contains("order.Status != expectedStatus.Value", body, StringComparison.Ordinal);
        Assert.Contains("currentStatus = order.Status.ToString()", body, StringComparison.Ordinal);
    }

    private static string TransitionBody()
    {
        var source = File.ReadAllText(Path.Combine(
            RepositoryRoot(), "DineFlow.Api", "Controllers", "AdminOrdersController.cs"));
        var marker = "public async Task<ActionResult<AdminOrderResponse>> TransitionOrder";
        var start = source.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, "Could not find the staff transition endpoint.");
        var end = source.IndexOf("\n    private ", start, StringComparison.Ordinal);
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
