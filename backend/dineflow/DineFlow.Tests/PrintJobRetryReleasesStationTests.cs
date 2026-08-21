using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Printing;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A manual retry has to put the ticket back where any station can take it.
/// </summary>
/// <remarks>
/// <para>
/// A job keeps the station that last handled it, and a station is per-browser — close one, open
/// another, and a new one exists. The claim offers a job only to its own station or to none, so a
/// ticket that failed last week stayed owned by a station that would never poll again. Retrying it
/// left it Pending for ever with a working printer sitting right there and nothing saying why.
/// </para>
/// </remarks>
public sealed class PrintJobRetryReleasesStationTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly Guid _restaurantId = Guid.NewGuid();
    private Guid _jobId;
    private Guid _deadStationId;
    private HttpClient _staff = null!;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(FrontCounterScenario.Restaurant(_restaurantId, "Retry Kitchen"));

            // The browser session that was open when the ticket failed, and has not been seen since.
            var deadStation = new PrintStation
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                StationKey = Guid.NewGuid().ToString(),
                Name = "Kitchen station that is gone",
                AutoPrintEnabled = true,
                LastSeenAt = DateTime.UtcNow.AddDays(-7)
            };
            _deadStationId = deadStation.Id;

            var order = new Order
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                OrderNumber = "RETRY-1",
                Status = OrderStatus.Completed,
                PaymentStatus = PaymentStatus.Paid,
                PaymentMethod = PaymentMethod.Online,
                TotalAmount = 10m
            };

            var job = new PrintJob
            {
                Id = Guid.NewGuid(),
                OrderId = order.Id,
                RestaurantId = _restaurantId,
                DeduplicationKey = Guid.NewGuid().ToString("N"),
                State = PrintJobState.DeadLetter,
                Attempts = 10,
                StationId = deadStation.Id,
                LastError = "Printer reports ERROR.",
                CreatedAt = DateTime.UtcNow.AddDays(-7),
                UpdatedAt = DateTime.UtcNow.AddDays(-7)
            };
            _jobId = job.Id;

            context.PrintStations.Add(deadStation);
            context.Orders.Add(order);
            context.PrintJobs.Add(job);
            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("retry-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private async Task<PrintJob> JobAsync()
    {
        PrintJob? job = null;
        await _api.UseDbAsync(async context =>
            job = await context.PrintJobs.AsNoTracking().SingleAsync(item => item.Id == _jobId));
        return job!;
    }

    [RequiresPostgresFact]
    public async Task LetsAnyStationTakeTheTicketAgain()
    {
        (await _staff.PostAsJsonAsync($"/api/printing/jobs/{_jobId}/retry", new { reason = "Printer is back." }))
            .EnsureSuccessStatusCode();

        var job = await JobAsync();

        // Unowned is what makes it claimable: the claim offers a job to its own station or to none.
        Assert.Null(job.StationId);
        Assert.Equal(PrintJobState.Pending, job.State);
    }

    /// <summary>Nothing is left holding it: no lease, no backoff, no spent attempts.</summary>
    [RequiresPostgresFact]
    public async Task LeavesNothingElseHoldingIt()
    {
        (await _staff.PostAsJsonAsync($"/api/printing/jobs/{_jobId}/retry", new { reason = "Printer is back." }))
            .EnsureSuccessStatusCode();

        var job = await JobAsync();

        Assert.Null(job.LeaseToken);
        Assert.Null(job.LeaseExpiresAt);
        Assert.Null(job.NextAttemptAt);
        Assert.Equal(0, job.Attempts);
        Assert.Null(job.LastError);
    }

    /// <summary>
    /// The way out when nobody presses Retry.
    /// </summary>
    /// <remarks>
    /// Retry only shows on a failed job. A job already moved to Pending and owned by a station that
    /// has gone had no button at all and no way back — it simply sat there. A station that has
    /// stopped polling must not keep tickets nobody else can take.
    /// </remarks>
    [RequiresPostgresFact]
    public async Task LetsALiveStationClaimATicketStrandedOnAStationThatIsGone()
    {
        // Already Pending and still owned by the station that vanished: the state this got stuck in.
        await _api.UseDbAsync(async context =>
        {
            var stranded = await context.PrintJobs.SingleAsync(item => item.Id == _jobId);
            stranded.State = PrintJobState.Pending;
            stranded.Attempts = 0;
            stranded.NextAttemptAt = null;
            await context.SaveChangesAsync();
        });

        // The station someone is standing at now, registered and polling.
        var liveStationKey = Guid.NewGuid().ToString();
        await _api.UseDbAsync(async context =>
        {
            context.PrintStations.Add(new PrintStation
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                StationKey = liveStationKey,
                Name = "Kitchen station that is here now",
                AutoPrintEnabled = true,
                LastSeenAt = DateTime.UtcNow
            });
            await context.SaveChangesAsync();
        });

        var claimed = await _staff.PostAsJsonAsync("/api/printing/jobs/claim", new
        {
            restaurantId = _restaurantId,
            stationKey = liveStationKey,
            clientInstanceId = Guid.NewGuid().ToString(),
            stationName = "Kitchen station that is here now",
            autoPrintEnabled = true,
            maxJobs = 5
        });

        claimed.EnsureSuccessStatusCode();
        var job = await JobAsync();
        Assert.Equal(PrintJobState.Claimed, job.State);
        Assert.NotEqual(_deadStationId, job.StationId);
    }

    /// <summary>
    /// A station that is merely slow keeps its own work.
    /// </summary>
    /// <remarks>
    /// The other half of letting abandoned tickets go. If a station that is still polling can have a
    /// ticket taken from under it, two printers produce the same ticket — worse than the ticket that
    /// was stuck, because nobody notices two.
    /// </remarks>
    [RequiresPostgresFact]
    public async Task LeavesATicketWithAStationThatIsStillPolling()
    {
        await _api.UseDbAsync(async context =>
        {
            var owner = await context.PrintStations.SingleAsync(item => item.Id == _deadStationId);
            // Seen a moment ago: busy, not gone.
            owner.LastSeenAt = DateTime.UtcNow;

            var stranded = await context.PrintJobs.SingleAsync(item => item.Id == _jobId);
            stranded.State = PrintJobState.Pending;
            stranded.Attempts = 0;
            stranded.NextAttemptAt = null;
            await context.SaveChangesAsync();
        });

        var otherStationKey = Guid.NewGuid().ToString();
        await _api.UseDbAsync(async context =>
        {
            context.PrintStations.Add(new PrintStation
            {
                Id = Guid.NewGuid(),
                RestaurantId = _restaurantId,
                StationKey = otherStationKey,
                Name = "A different station",
                AutoPrintEnabled = true,
                LastSeenAt = DateTime.UtcNow
            });
            await context.SaveChangesAsync();
        });

        (await _staff.PostAsJsonAsync("/api/printing/jobs/claim", new
        {
            restaurantId = _restaurantId,
            stationKey = otherStationKey,
            clientInstanceId = Guid.NewGuid().ToString(),
            stationName = "A different station",
            autoPrintEnabled = true,
            maxJobs = 5
        })).EnsureSuccessStatusCode();

        var job = await JobAsync();
        Assert.Equal(PrintJobState.Pending, job.State);
        Assert.Equal(_deadStationId, job.StationId);
    }

    /// <summary>The station that failed it is still on the record, which is how it stays diagnosable.</summary>
    [RequiresPostgresFact]
    public async Task KeepsTheFailedAttemptOnTheStationsOwnRecord()
    {
        await _api.UseDbAsync(async context =>
            Assert.True(await context.PrintStations.AnyAsync(station => station.Id == _deadStationId)));
    }
}
