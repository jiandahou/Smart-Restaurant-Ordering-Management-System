using System.Reflection;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Printing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

public class PrintingReliabilityContractTests
{
    [Fact]
    public void PrintingApi_RequiresStaffPolicy()
    {
        var authorize = typeof(PrintingController).GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.StaffApi, authorize!.Policy);
    }

    [Fact]
    public void PrintJob_DeduplicationKey_HasUniqueDatabaseIndex()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"printing-model-{Guid.NewGuid():N}")
            .Options;
        using var dbContext = new AppDbContext(options);

        var entity = dbContext.Model.FindEntityType(typeof(PrintJob));
        var index = entity?.GetIndexes().SingleOrDefault(candidate =>
            candidate.Properties.Count == 1 &&
            candidate.Properties[0].Name == nameof(PrintJob.DeduplicationKey));

        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
    }

    [Fact]
    public void PrintStation_Identity_IsUniqueWithinRestaurant()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"printing-model-{Guid.NewGuid():N}")
            .Options;
        using var dbContext = new AppDbContext(options);

        var entity = dbContext.Model.FindEntityType(typeof(PrintStation));
        var index = entity?.GetIndexes().SingleOrDefault(candidate =>
            candidate.Properties.Select(property => property.Name)
                .SequenceEqual([nameof(PrintStation.RestaurantId), nameof(PrintStation.StationKey)]));

        Assert.NotNull(index);
        Assert.True(index!.IsUnique);
    }
}
