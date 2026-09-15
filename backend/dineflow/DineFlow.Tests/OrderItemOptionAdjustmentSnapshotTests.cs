using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// Both paths that turn a cart into an order must record what an option did to the price, not only
/// how much it did it by.
/// </summary>
/// <remarks>
/// <para>
/// The amount was snapshotted from the start and its meaning was not. The same stored 3.00 is a
/// surcharge under Add, a discount under Remove, and the whole price of the line under Replace,
/// which throws away the base and every option before it. Which one applied could only be recovered
/// from the live menu row — and that is not a record: options get archived, which is why the
/// reference is nullable, and a restaurant can change an option's type whenever it likes.
/// </para>
/// <para>
/// Checked as source text because the alternative is standing up two controllers, their menus and
/// their carts to assert one assignment. What can go wrong here is somebody adding a third path, or
/// deleting the line while refactoring the object initialiser around it; both show up in the text.
/// </para>
/// </remarks>
public sealed class OrderItemOptionAdjustmentSnapshotTests
{
    [Theory]
    [InlineData("PublicCartsController.cs")]
    [InlineData("OrderController.cs")]
    public void EveryPathThatSnapshotsAnOptionRecordsWhatItDidToThePrice(string file)
    {
        var body = Source(file);
        var snapshot = body.IndexOf("PriceAdjustmentSnapshot = option.PriceAdjustment", StringComparison.Ordinal);

        Assert.True(snapshot >= 0, $"{file} no longer snapshots an option price; this test cannot read it.");

        var initialiser = body[snapshot..Math.Min(body.Length, snapshot + 900)];

        Assert.Contains("AdjustmentTypeSnapshot = option.AdjustmentType", initialiser, StringComparison.Ordinal);
    }

    /// <summary>
    /// Null has to stay reachable. It is how a row written before the column existed says the type
    /// is unknown, and everything that prices a modifier is required to decline rather than assume.
    /// </summary>
    [Fact]
    public void TheSnapshotCanSayItDoesNotKnow()
    {
        var option = new DineFlow.Infrastructure.Orders.OrderItemOption();

        Assert.Null(option.AdjustmentTypeSnapshot);
    }

    private static string Source(string file)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);

        return File.ReadAllText(Path.Combine(directory!.FullName, "DineFlow.Api", "Controllers", file));
    }
}
