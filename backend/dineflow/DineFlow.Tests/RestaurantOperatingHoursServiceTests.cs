using DineFlow.Api.Services;
using DineFlow.Infrastructure.Restaurant;
using Xunit;

namespace DineFlow.Tests;

public class RestaurantOperatingHoursServiceTests
{
    private const string FullDayMondayJson =
        "[{\"dayOfWeek\":0,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]},{\"dayOfWeek\":2,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":3,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":4,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":5,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]},{\"dayOfWeek\":6,\"isOpen\":false,\"windows\":[{\"opensAt\":\"09:00\",\"closesAt\":\"21:00\"}]}]";

    [Fact]
    public void TryNormalizeOpeningHoursJson_AcceptsMidnightToMidnightAsFullDay()
    {
        var service = new RestaurantOperatingHoursService();

        var result = service.TryNormalizeOpeningHoursJson(
            FullDayMondayJson,
            out var normalized,
            out var error);

        Assert.True(result);
        Assert.Null(error);
        Assert.Contains("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", normalized);
    }

    [Fact]
    public void TryNormalizeOpeningHoursJson_RejectsOtherIdenticalTimes()
    {
        var service = new RestaurantOperatingHoursService();
        var invalid = FullDayMondayJson
            .Replace("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", "\"opensAt\":\"09:00\",\"closesAt\":\"09:00\"");

        var result = service.TryNormalizeOpeningHoursJson(invalid, out _, out var error);

        Assert.False(result);
        Assert.Contains("except 00:00 to 00:00", error);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(8, 30)]
    [InlineData(23, 59)]
    public void GetAvailability_MidnightToMidnight_IsOpenForTheWholeDay(int hour, int minute)
    {
        var service = new RestaurantOperatingHoursService();
        var restaurant = new Restaurant
        {
            IsActive = true,
            AcceptingOrders = true,
            Timezone = "UTC",
            OpeningHoursJson = FullDayMondayJson
        };
        var monday = new DateTime(2026, 7, 27, hour, minute, 0, DateTimeKind.Utc);

        var availability = service.GetAvailability(restaurant, monday);

        Assert.True(availability.IsWithinOpeningHours);
        Assert.True(availability.IsOrderingAvailable);
    }

    [Fact]
    public void TryNormalizeSpecialOpeningDaysJson_AcceptsMidnightToMidnightAsFullDay()
    {
        var service = new RestaurantOperatingHoursService();
        const string specialDay =
            "[{\"date\":\"2026-07-27\",\"isClosed\":false,\"windows\":[{\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"}]}]";

        var result = service.TryNormalizeSpecialOpeningDaysJson(
            specialDay,
            out var normalized,
            out var error);

        Assert.True(result);
        Assert.Null(error);
        Assert.Contains("\"opensAt\":\"00:00\",\"closesAt\":\"00:00\"", normalized);
    }
}
