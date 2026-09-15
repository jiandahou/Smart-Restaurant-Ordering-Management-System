using DineFlow.Api.Services;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Xunit;

using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Tests;

/// <summary>
/// The DineFlow Kitchen is the restaurant everything gets tried against, and 09:00–21:00 in
/// Adelaide leaves the demo shut for most of a working day elsewhere — so every session started by
/// prising its hours open and ended by putting them back.
/// </summary>
public sealed class RestaurantOneAllDayHoursTests
{
    private static readonly Guid RestaurantOne = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public async Task TheDemoRestaurantEndsUpOpenAtEveryHourOfEveryDay()
    {
        await using var db = BuildDatabase(RestaurantOperatingHoursService.DefaultOpeningHoursJson);

        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        var restaurant = await db.Restaurants.FirstAsync();
        var service = new RestaurantOperatingHoursService();

        // Checked through the service rather than by string match: 00:00 to 00:00 only means "all
        // day" because that is how the service reads it.
        foreach (var hour in new[] { 0, 3, 8, 12, 20, 23 })
        {
            var moment = new DateTime(2026, 8, 17, hour, 30, 0, DateTimeKind.Utc);
            Assert.True(
                service.GetAvailability(restaurant, moment).IsOrderingAvailable,
                $"should be open at {hour:00}:30 UTC");
        }
    }

    /// <summary>
    /// Hours somebody set on purpose — a closed day, a split lunch and dinner service — are a
    /// decision, not a default waiting to be corrected.
    /// </summary>
    [Fact]
    public async Task HoursSomebodyChoseAreLeftAlone()
    {
        const string chosen =
            "[{\"dayOfWeek\":0,\"isOpen\":false,\"windows\":[]}," +
            "{\"dayOfWeek\":1,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}," +
            "{\"dayOfWeek\":2,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}," +
            "{\"dayOfWeek\":3,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}," +
            "{\"dayOfWeek\":4,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}," +
            "{\"dayOfWeek\":5,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}," +
            "{\"dayOfWeek\":6,\"isOpen\":true,\"windows\":[{\"opensAt\":\"11:00\",\"closesAt\":\"14:00\"}]}]";
        await using var db = BuildDatabase(chosen);

        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        Assert.Equal(chosen, (await db.Restaurants.FirstAsync()).OpeningHoursJson);
    }

    [Fact]
    public async Task RunningTwiceChangesNothingTheSecondTime()
    {
        await using var db = BuildDatabase(RestaurantOperatingHoursService.DefaultOpeningHoursJson);

        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);
        var afterFirst = (await db.Restaurants.FirstAsync()).OpeningHoursJson;
        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        Assert.Equal(afterFirst, (await db.Restaurants.FirstAsync()).OpeningHoursJson);
    }

    /// Putting the default hours back is how a developer gets ordinary trading hours again.
    [Fact]
    public async Task RestoringTheDefaultHoursLetsThemBeOpenedAgain()
    {
        await using var db = BuildDatabase(RestaurantOperatingHoursService.DefaultOpeningHoursJson);
        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        var restaurant = await db.Restaurants.FirstAsync();
        restaurant.OpeningHoursJson = RestaurantOperatingHoursService.DefaultOpeningHoursJson;
        await db.SaveChangesAsync();

        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        Assert.NotEqual(
            RestaurantOperatingHoursService.DefaultOpeningHoursJson,
            (await db.Restaurants.FirstAsync()).OpeningHoursJson);
    }

    /// <summary>
    /// Only this restaurant. The others keep ordinary hours so closed-restaurant behaviour — refused
    /// orders, the auto-refund sweep — still has somewhere to be tested.
    /// </summary>
    [Fact]
    public async Task OtherRestaurantsKeepTheirTradingHours()
    {
        await using var db = BuildDatabase(RestaurantOperatingHoursService.DefaultOpeningHoursJson);
        var otherId = Guid.Parse("22222222-2222-2222-2222-222222222222");
        db.Restaurants.Add(new RestaurantEntity
        {
            Id = otherId,
            Name = "Spice Garden",
            Currency = "INR",
            CountryCode = "IN",
            Timezone = "Asia/Kolkata",
            IsActive = true,
            OpeningHoursJson = RestaurantOperatingHoursService.DefaultOpeningHoursJson,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();

        await IdentitySeeder.OpenRestaurantOneAllDayAsync(db);

        var other = await db.Restaurants.FirstAsync(r => r.Id == otherId);
        Assert.Equal(RestaurantOperatingHoursService.DefaultOpeningHoursJson, other.OpeningHoursJson);
    }

    private static AppDbContext BuildDatabase(string openingHoursJson)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"all-day-{Guid.NewGuid():N}")
            .Options);

        db.Restaurants.Add(new RestaurantEntity
        {
            Id = RestaurantOne,
            Name = "The DineFlow Kitchen",
            CountryCode = "AU",
            Timezone = "Australia/Adelaide",
            Currency = "AUD",
            IsActive = true,
            AcceptingOrders = true,
            OpeningHoursJson = openingHoursJson,
            CreatedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        return db;
    }
}
