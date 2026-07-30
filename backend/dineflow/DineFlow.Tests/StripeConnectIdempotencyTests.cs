using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class StripeConnectIdempotencyTests
{
    private static readonly Guid RestaurantId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherRestaurantId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    [Fact]
    public void DoubleClicksWithinTheWindowShareAKey()
    {
        var first = StripeConnectIdempotency.BuildAccountCreationKey(
            RestaurantId, new DateTime(2026, 7, 29, 14, 2, 25, DateTimeKind.Utc));
        var secondsLater = StripeConnectIdempotency.BuildAccountCreationKey(
            RestaurantId, new DateTime(2026, 7, 29, 14, 2, 31, DateTimeKind.Utc));

        // This is the case idempotency exists for: two accounts must not be created.
        Assert.Equal(first, secondsLater);
    }

    [Fact]
    public void ARetryAfterTheWindowGetsAFreshKey()
    {
        var duringOutage = StripeConnectIdempotency.BuildAccountCreationKey(
            RestaurantId, new DateTime(2026, 7, 29, 13, 55, 10, DateTimeKind.Utc));
        var afterFixingConfig = StripeConnectIdempotency.BuildAccountCreationKey(
            RestaurantId, new DateTime(2026, 7, 29, 14, 6, 0, DateTimeKind.Utc));

        // Without this, Stripe replays the cached failure for 24h and only a redeploy clears it.
        Assert.NotEqual(duringOutage, afterFixingConfig);
    }

    [Fact]
    public void RestaurantsNeverShareAKey()
    {
        var moment = new DateTime(2026, 7, 29, 14, 2, 25, DateTimeKind.Utc);

        Assert.NotEqual(
            StripeConnectIdempotency.BuildAccountCreationKey(RestaurantId, moment),
            StripeConnectIdempotency.BuildAccountCreationKey(OtherRestaurantId, moment));
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(9, 0)]
    [InlineData(10, 10)]
    [InlineData(59, 50)]
    public void KeysAreBucketedToTheStartOfTheWindow(int minute, int expectedBucketMinute)
    {
        var key = StripeConnectIdempotency.BuildAccountCreationKey(
            RestaurantId, new DateTime(2026, 7, 29, 14, minute, 30, DateTimeKind.Utc));

        Assert.EndsWith($"2026072914{expectedBucketMinute:D2}", key);
    }
}
